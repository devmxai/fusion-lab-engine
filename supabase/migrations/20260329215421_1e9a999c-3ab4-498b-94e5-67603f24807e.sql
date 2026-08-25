-- 1) Ensure every user has a credits wallet row (idempotent helper)
CREATE OR REPLACE FUNCTION public.ensure_user_credits_row(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_credits (user_id, balance, total_earned, total_spent, updated_at)
  VALUES (p_user_id, 0, 0, 0, now())
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

-- 2) Harden admin subscription activation against missing wallet rows
CREATE OR REPLACE FUNCTION public.admin_activate_subscription(
  p_target_user_id uuid,
  p_plan_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_plan subscription_plans%ROWTYPE;
  v_expires_at timestamptz;
  v_days integer;
BEGIN
  IF NOT has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_plan FROM subscription_plans WHERE id = p_plan_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_not_found');
  END IF;

  v_days := GREATEST(COALESCE(p_days, 30), 1);
  v_expires_at := now() + (v_days || ' days')::interval;

  -- Expire any currently active sub first
  UPDATE user_subscriptions
  SET status = 'expired', updated_at = now()
  WHERE user_id = p_target_user_id AND status = 'active';

  INSERT INTO user_subscriptions (user_id, plan_id, status, starts_at, expires_at, activated_by)
  VALUES (p_target_user_id, p_plan_id, 'active', now(), v_expires_at, v_admin_id);

  -- Critical: guarantee wallet row exists before credit mutation
  PERFORM public.ensure_user_credits_row(p_target_user_id);

  UPDATE user_credits
  SET
    balance = balance + v_plan.credits_per_month,
    total_earned = total_earned + v_plan.credits_per_month,
    updated_at = now()
  WHERE user_id = p_target_user_id;

  INSERT INTO credit_transactions (user_id, amount, action, description, granted_by)
  VALUES (
    p_target_user_id,
    v_plan.credits_per_month,
    'subscription_grant',
    'اشتراك ' || v_plan.name_ar || ' (' || v_days || ' يوم)',
    v_admin_id
  );

  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (
    v_admin_id,
    'activate_subscription',
    'user',
    p_target_user_id::text,
    jsonb_build_object('plan_id', p_plan_id, 'plan_name', v_plan.name, 'days', v_days, 'credits', v_plan.credits_per_month)
  );

  RETURN jsonb_build_object('success', true, 'expires_at', v_expires_at);
END;
$function$;

-- 3) Harden admin grant credits against missing wallet rows
CREATE OR REPLACE FUNCTION public.admin_grant_credits(
  p_target_user_id uuid,
  p_amount integer,
  p_description text DEFAULT 'منحة من الإدارة'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
BEGIN
  IF NOT has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount');
  END IF;

  PERFORM public.ensure_user_credits_row(p_target_user_id);

  UPDATE user_credits
  SET
    balance = balance + p_amount,
    total_earned = total_earned + p_amount,
    updated_at = now()
  WHERE user_id = p_target_user_id;

  INSERT INTO credit_transactions (user_id, amount, action, description, granted_by)
  VALUES (p_target_user_id, p_amount, 'admin_grant', p_description, v_admin_id);

  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (
    v_admin_id,
    'grant_credits',
    'user',
    p_target_user_id::text,
    jsonb_build_object('amount', p_amount, 'description', p_description)
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 4) Harden admin reset credits against missing wallet rows and keep totals consistent
CREATE OR REPLACE FUNCTION public.admin_reset_credits(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_old_balance integer := 0;
BEGIN
  IF NOT has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  PERFORM public.ensure_user_credits_row(p_target_user_id);

  SELECT COALESCE(balance, 0)
  INTO v_old_balance
  FROM user_credits
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  UPDATE user_credits
  SET
    balance = 0,
    total_spent = total_spent + v_old_balance,
    updated_at = now()
  WHERE user_id = p_target_user_id;

  IF v_old_balance > 0 THEN
    INSERT INTO credit_transactions (user_id, amount, action, description, granted_by)
    VALUES (p_target_user_id, v_old_balance, 'spent', 'إعادة تعيين الرصيد بواسطة الإدارة', v_admin_id);
  END IF;

  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (
    v_admin_id,
    'reset_credits',
    'user',
    p_target_user_id::text,
    jsonb_build_object('old_balance', v_old_balance)
  );

  RETURN jsonb_build_object('success', true, 'old_balance', v_old_balance);
END;
$function$;

-- 5) Harden reserve flow: auto-create wallet row if missing (prevents no_credit_record race after data resets)
CREATE OR REPLACE FUNCTION public.validate_and_reserve(
  p_model text,
  p_tool_id text,
  p_resolution text DEFAULT NULL::text,
  p_quality text DEFAULT NULL::text,
  p_duration_seconds integer DEFAULT NULL::integer,
  p_has_audio boolean DEFAULT NULL::boolean,
  p_idempotency_key text DEFAULT NULL::text,
  p_generation_type text DEFAULT 'default'::text,
  p_character_count integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_entitlement jsonb;
  v_pricing jsonb;
  v_credits numeric;
  v_balance numeric;
  v_reservation_id uuid;
  v_existing_id uuid;
  v_snapshot jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM credit_reservations
    WHERE idempotency_key = p_idempotency_key
      AND user_id = v_user_id
      AND status = 'reserved';

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'reservation_id', v_existing_id, 'idempotent', true);
    END IF;
  END IF;

  v_entitlement := check_entitlement(v_user_id, p_model, p_resolution, p_duration_seconds, p_quality, p_generation_type);
  IF NOT (v_entitlement->>'allowed')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'entitlement_denied', 'details', v_entitlement);
  END IF;

  v_pricing := server_calculate_price(p_model, p_resolution, p_quality, p_duration_seconds, p_has_audio, p_character_count);
  IF NOT (v_pricing->>'found')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_pricing_rule');
  END IF;

  v_credits := (v_pricing->>'credits')::numeric;
  IF v_credits <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_price');
  END IF;

  -- Critical: guarantee wallet exists even for accounts that had data manually deleted
  PERFORM public.ensure_user_credits_row(v_user_id);

  SELECT balance INTO v_balance
  FROM user_credits
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_credit_record');
  END IF;

  IF v_balance < v_credits THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_credits', 'balance', v_balance, 'required', v_credits);
  END IF;

  v_snapshot := jsonb_build_object(
    'model', p_model,
    'resolution', p_resolution,
    'quality', p_quality,
    'durationSeconds', p_duration_seconds,
    'hasAudio', p_has_audio,
    'characterCount', p_character_count,
    'credits', v_credits,
    'priceUnit', v_pricing->>'price_unit',
    'ruleId', v_pricing->>'rule_id',
    'calculatedAt', now()
  );

  UPDATE user_credits
  SET balance = balance - v_credits, updated_at = now()
  WHERE user_id = v_user_id;

  INSERT INTO credit_reservations (user_id, amount, tool_id, model, idempotency_key, pricing_snapshot, status)
  VALUES (v_user_id, v_credits, p_tool_id, p_model, p_idempotency_key, v_snapshot, 'reserved')
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'credits_charged', v_credits,
    'plan', v_entitlement->>'plan'
  );
END;
$function$;