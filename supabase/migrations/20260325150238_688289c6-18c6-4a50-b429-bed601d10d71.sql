
-- 1. Add generation_type + aspect_ratio to pricing calculation
-- Expand check_entitlement to verify image resolution, video resolution, quality
CREATE OR REPLACE FUNCTION public.check_entitlement(
  p_user_id uuid,
  p_model text,
  p_resolution text DEFAULT NULL,
  p_duration_seconds integer DEFAULT NULL,
  p_quality text DEFAULT NULL,
  p_generation_type text DEFAULT 'default'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_plan text;
  v_min_plan text;
  v_ent plan_entitlements%ROWTYPE;
  v_daily_count integer;
  v_plan_rank integer;
  v_min_rank integer;
  v_model_category text;
BEGIN
  -- Get user plan
  SELECT sp.type::text INTO v_user_plan
  FROM user_subscriptions us
  JOIN subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = p_user_id
    AND us.status = 'active'
    AND (us.expires_at IS NULL OR us.expires_at > now())
  ORDER BY us.created_at DESC LIMIT 1;

  v_user_plan := COALESCE(v_user_plan, 'free');

  -- Check model access
  SELECT ma.min_plan, ma.category INTO v_min_plan, v_model_category
  FROM model_access ma WHERE ma.model = p_model AND ma.is_active = true;

  IF v_min_plan IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'model_not_found', 'plan', v_user_plan);
  END IF;

  v_plan_rank := CASE v_user_plan WHEN 'pro' THEN 3 WHEN 'plus' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END;
  v_min_rank := CASE v_min_plan WHEN 'pro' THEN 3 WHEN 'plus' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END;

  IF v_plan_rank < v_min_rank THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'plan_upgrade_required', 'plan', v_user_plan, 'required_plan', v_min_plan);
  END IF;

  -- Get entitlements
  SELECT * INTO v_ent FROM plan_entitlements WHERE plan_type = v_user_plan;
  IF v_ent IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_entitlement_config', 'plan', v_user_plan);
  END IF;

  -- Daily generation limit
  SELECT COUNT(*) INTO v_daily_count FROM generations
  WHERE user_id = p_user_id AND created_at > (now() - interval '24 hours');

  IF v_ent.daily_generation_limit IS NOT NULL AND v_daily_count >= v_ent.daily_generation_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'daily_limit_reached', 'plan', v_user_plan,
      'limit', v_ent.daily_generation_limit, 'used', v_daily_count);
  END IF;

  -- Video duration check
  IF p_duration_seconds IS NOT NULL AND v_ent.max_video_duration_seconds IS NOT NULL
     AND p_duration_seconds > v_ent.max_video_duration_seconds THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'duration_exceeded', 'plan', v_user_plan,
      'max_duration', v_ent.max_video_duration_seconds);
  END IF;

  -- Image resolution check (category-based)
  IF p_resolution IS NOT NULL AND v_model_category IN ('image', 'remix', 'upscale') THEN
    IF v_ent.max_image_resolution IS NOT NULL THEN
      DECLARE
        v_req_rank integer;
        v_max_rank integer;
      BEGIN
        v_req_rank := CASE lower(p_resolution)
          WHEN '1k' THEN 1 WHEN '2k' THEN 2 WHEN '4k' THEN 3 WHEN '8k' THEN 4 ELSE 1 END;
        v_max_rank := CASE lower(v_ent.max_image_resolution)
          WHEN '1k' THEN 1 WHEN '2k' THEN 2 WHEN '4k' THEN 3 WHEN '8k' THEN 4 ELSE 2 END;
        IF v_req_rank > v_max_rank THEN
          RETURN jsonb_build_object('allowed', false, 'reason', 'image_resolution_exceeded', 'plan', v_user_plan,
            'max_resolution', v_ent.max_image_resolution, 'requested', p_resolution);
        END IF;
      END;
    END IF;
  END IF;

  -- Video resolution check
  IF p_resolution IS NOT NULL AND v_model_category IN ('video', 'avatar') THEN
    IF v_ent.max_video_resolution IS NOT NULL THEN
      DECLARE
        v_req_vrank integer;
        v_max_vrank integer;
      BEGIN
        v_req_vrank := CASE lower(p_resolution)
          WHEN '360p' THEN 1 WHEN '480p' THEN 2 WHEN '720p' THEN 3 WHEN '1080p' THEN 4 WHEN '4k' THEN 5 ELSE 2 END;
        v_max_vrank := CASE lower(v_ent.max_video_resolution)
          WHEN '360p' THEN 1 WHEN '480p' THEN 2 WHEN '720p' THEN 3 WHEN '1080p' THEN 4 WHEN '4k' THEN 5 ELSE 3 END;
        IF v_req_vrank > v_max_vrank THEN
          RETURN jsonb_build_object('allowed', false, 'reason', 'video_resolution_exceeded', 'plan', v_user_plan,
            'max_resolution', v_ent.max_video_resolution, 'requested', p_resolution);
        END IF;
      END;
    END IF;
  END IF;

  -- Feature checks from entitlements.features JSONB
  IF v_ent.features IS NOT NULL AND v_ent.features != '{}'::jsonb THEN
    -- Check audio feature
    IF p_generation_type = 'audio' AND NOT COALESCE((v_ent.features->>'audio_enabled')::boolean, true) THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'feature_not_available', 'plan', v_user_plan, 'feature', 'audio');
    END IF;
    -- Check quality restrictions
    IF p_quality IS NOT NULL AND v_ent.features ? 'max_quality' THEN
      DECLARE
        v_req_qrank integer;
        v_max_qrank integer;
      BEGIN
        v_req_qrank := CASE lower(p_quality)
          WHEN 'basic' THEN 1 WHEN 'std' THEN 2 WHEN 'standard' THEN 2 WHEN 'high' THEN 3 WHEN 'ultra' THEN 4 ELSE 2 END;
        v_max_qrank := CASE lower(v_ent.features->>'max_quality')
          WHEN 'basic' THEN 1 WHEN 'std' THEN 2 WHEN 'standard' THEN 2 WHEN 'high' THEN 3 WHEN 'ultra' THEN 4 ELSE 3 END;
        IF v_req_qrank > v_max_qrank THEN
          RETURN jsonb_build_object('allowed', false, 'reason', 'quality_exceeded', 'plan', v_user_plan,
            'max_quality', v_ent.features->>'max_quality', 'requested', p_quality);
        END IF;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'plan', v_user_plan,
    'daily_remaining', COALESCE(v_ent.daily_generation_limit, 999) - v_daily_count);
END;
$$;

-- 2. Update validate_and_reserve to pass new params to check_entitlement
CREATE OR REPLACE FUNCTION public.validate_and_reserve(
  p_model text,
  p_tool_id text,
  p_resolution text DEFAULT NULL,
  p_quality text DEFAULT NULL,
  p_duration_seconds integer DEFAULT NULL,
  p_has_audio boolean DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_generation_type text DEFAULT 'default'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM credit_reservations
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id AND status = 'reserved';
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'reservation_id', v_existing_id, 'idempotent', true);
    END IF;
  END IF;

  -- Entitlement check (expanded)
  v_entitlement := check_entitlement(v_user_id, p_model, p_resolution, p_duration_seconds, p_quality, p_generation_type);
  IF NOT (v_entitlement->>'allowed')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'entitlement_denied', 'details', v_entitlement);
  END IF;

  -- Price calculation (only active rules)
  v_pricing := server_calculate_price(p_model, p_resolution, p_quality, p_duration_seconds, p_has_audio);
  IF NOT (v_pricing->>'found')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_pricing_rule');
  END IF;

  v_credits := (v_pricing->>'credits')::numeric;
  IF v_credits <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_price');
  END IF;

  -- Balance check with row lock
  SELECT balance INTO v_balance FROM user_credits WHERE user_id = v_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_credit_record');
  END IF;
  IF v_balance < v_credits THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_credits', 'balance', v_balance, 'required', v_credits);
  END IF;

  -- Build snapshot
  v_snapshot := jsonb_build_object(
    'model', p_model, 'resolution', p_resolution, 'quality', p_quality,
    'durationSeconds', p_duration_seconds, 'hasAudio', p_has_audio,
    'generationType', p_generation_type,
    'credits', v_credits, 'priceUnit', v_pricing->>'price_unit',
    'ruleId', v_pricing->>'rule_id', 'calculatedAt', now()
  );

  -- Deduct and reserve
  UPDATE user_credits SET balance = balance - v_credits, updated_at = now() WHERE user_id = v_user_id;

  INSERT INTO credit_reservations (user_id, amount, tool_id, model, idempotency_key, pricing_snapshot, status)
  VALUES (v_user_id, v_credits, p_tool_id, p_model, p_idempotency_key, v_snapshot, 'reserved')
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'success', true, 'reservation_id', v_reservation_id,
    'credits_charged', v_credits, 'plan', v_entitlement->>'plan'
  );
END;
$$;

-- 3. Create subscription expiry enforcement function
CREATE OR REPLACE FUNCTION public.enforce_subscription_expiry()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expired_count integer;
BEGIN
  UPDATE user_subscriptions 
  SET status = 'expired', updated_at = now()
  WHERE status = 'active' 
    AND expires_at IS NOT NULL 
    AND expires_at <= now();
  
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;
  
  RETURN jsonb_build_object('success', true, 'expired_count', v_expired_count, 'checked_at', now());
END;
$$;

-- 4. Create stale reservation cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_stale_reservations(p_older_than_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cleaned integer := 0;
  v_res RECORD;
BEGIN
  FOR v_res IN 
    SELECT * FROM credit_reservations 
    WHERE status = 'reserved' 
      AND created_at < (now() - (p_older_than_hours || ' hours')::interval)
    FOR UPDATE
  LOOP
    -- Release credits back
    UPDATE user_credits SET balance = balance + v_res.amount, updated_at = now()
      WHERE user_id = v_res.user_id;
    
    UPDATE credit_reservations SET status = 'released', released_at = now()
      WHERE id = v_res.id;
    
    INSERT INTO credit_transactions (user_id, amount, action, description)
    VALUES (v_res.user_id, v_res.amount, 'refund', 'استرداد تلقائي - حجز معلق | ' || v_res.tool_id);
    
    v_cleaned := v_cleaned + 1;
  END LOOP;
  
  RETURN jsonb_build_object('success', true, 'cleaned_count', v_cleaned, 'checked_at', now());
END;
$$;

-- 5. Create reconciliation check function
CREATE OR REPLACE FUNCTION public.reconciliation_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mismatches jsonb := '[]'::jsonb;
  v_stale_count integer;
  v_rec RECORD;
BEGIN
  -- Count stale reservations (older than 2 hours)
  SELECT COUNT(*) INTO v_stale_count FROM credit_reservations
  WHERE status = 'reserved' AND created_at < (now() - interval '2 hours');

  -- Check for users with negative balance
  FOR v_rec IN 
    SELECT user_id, balance FROM user_credits WHERE balance < 0
  LOOP
    v_mismatches := v_mismatches || jsonb_build_object(
      'type', 'negative_balance', 'user_id', v_rec.user_id, 'balance', v_rec.balance
    );
  END LOOP;

  RETURN jsonb_build_object(
    'stale_reservations', v_stale_count,
    'mismatches', v_mismatches,
    'checked_at', now()
  );
END;
$$;

-- 6. Prevent duplicate active subscriptions via trigger
CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    UPDATE user_subscriptions 
    SET status = 'expired', updated_at = now()
    WHERE user_id = NEW.user_id 
      AND status = 'active' 
      AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_duplicate_active_subscription
  BEFORE INSERT OR UPDATE ON user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_active_subscription();

-- 7. Profile sync trigger - keep profiles.email in sync when auth changes
CREATE OR REPLACE FUNCTION public.sync_profile_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.profiles 
  SET email = NEW.email, updated_at = now()
  WHERE id = NEW.id AND (email IS DISTINCT FROM NEW.email);
  RETURN NEW;
END;
$$;
