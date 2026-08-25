
-- ===============================================
-- FUSIONLAB PRODUCTION INFRASTRUCTURE
-- Pricing Engine + Credit Ledger + Audit System
-- ===============================================

-- 1. Pricing Rules Table
CREATE TABLE public.pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  display_name text,
  generation_type text NOT NULL DEFAULT 'default',
  resolution text,
  quality text,
  duration_seconds integer,
  has_audio boolean,
  price_credits numeric(10,2) NOT NULL,
  price_unit text NOT NULL DEFAULT 'per_generation',
  source_url text,
  source_note text,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'pending_review',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pricing rules" ON public.pricing_rules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage pricing rules" ON public.pricing_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. Credit Reservations Table
CREATE TABLE public.credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric(10,2) NOT NULL,
  task_id text,
  tool_id text NOT NULL,
  model text NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  idempotency_key text UNIQUE,
  pricing_snapshot jsonb DEFAULT '{}',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  released_at timestamptz
);

ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own reservations" ON public.credit_reservations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins manage all reservations" ON public.credit_reservations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Audit Logs Table
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 4. SECURITY FIX: Remove dangerous client-side policies
DROP POLICY IF EXISTS "Users update own credits" ON public.user_credits;
DROP POLICY IF EXISTS "Users insert own transactions" ON public.credit_transactions;

-- 5. Atomic Credit Reserve Function
CREATE OR REPLACE FUNCTION public.reserve_credits(
  p_amount numeric,
  p_tool_id text,
  p_model text,
  p_idempotency_key text,
  p_pricing_snapshot jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_balance numeric;
  v_reservation_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  SELECT id INTO v_reservation_id FROM credit_reservations
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id AND status = 'reserved';
  IF v_reservation_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'reservation_id', v_reservation_id, 'idempotent', true);
  END IF;
  SELECT balance INTO v_balance FROM user_credits WHERE user_id = v_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_credit_record');
  END IF;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_credits', 'balance', v_balance, 'required', p_amount);
  END IF;
  UPDATE user_credits SET balance = balance - p_amount, updated_at = now() WHERE user_id = v_user_id;
  INSERT INTO credit_reservations (user_id, amount, tool_id, model, idempotency_key, pricing_snapshot, status)
  VALUES (v_user_id, p_amount, p_tool_id, p_model, p_idempotency_key, p_pricing_snapshot, 'reserved')
  RETURNING id INTO v_reservation_id;
  RETURN jsonb_build_object('success', true, 'reservation_id', v_reservation_id);
END;
$$;

-- 6. Settle Credits (success)
CREATE OR REPLACE FUNCTION public.settle_credits(
  p_reservation_id uuid,
  p_task_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_res credit_reservations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  SELECT * INTO v_res FROM credit_reservations
    WHERE id = p_reservation_id AND user_id = v_user_id FOR UPDATE;
  IF v_res IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;
  IF v_res.status != 'reserved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed');
  END IF;
  UPDATE credit_reservations SET status = 'settled', task_id = COALESCE(p_task_id, task_id), settled_at = now()
    WHERE id = p_reservation_id;
  INSERT INTO credit_transactions (user_id, amount, action, description)
  VALUES (v_user_id, v_res.amount, 'spent', 'توليد بـ ' || v_res.tool_id || ' | ' || v_res.model);
  UPDATE user_credits SET total_spent = total_spent + v_res.amount, updated_at = now()
    WHERE user_id = v_user_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- 7. Release Credits (failure refund)
CREATE OR REPLACE FUNCTION public.release_credits(
  p_reservation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_res credit_reservations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  SELECT * INTO v_res FROM credit_reservations
    WHERE id = p_reservation_id AND user_id = v_user_id FOR UPDATE;
  IF v_res IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;
  IF v_res.status != 'reserved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed');
  END IF;
  UPDATE user_credits SET balance = balance + v_res.amount, updated_at = now()
    WHERE user_id = v_user_id;
  UPDATE credit_reservations SET status = 'released', released_at = now()
    WHERE id = p_reservation_id;
  INSERT INTO credit_transactions (user_id, amount, action, description)
  VALUES (v_user_id, v_res.amount, 'refund', 'استرداد تلقائي - فشل التوليد | ' || v_res.tool_id);
  RETURN jsonb_build_object('success', true);
END;
$$;

-- 8. Admin: Grant Credits
CREATE OR REPLACE FUNCTION public.admin_grant_credits(
  p_target_user_id uuid,
  p_amount integer,
  p_description text DEFAULT 'منحة من الإدارة'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
BEGIN
  IF NOT has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  UPDATE user_credits SET balance = balance + p_amount, total_earned = total_earned + p_amount, updated_at = now()
    WHERE user_id = p_target_user_id;
  INSERT INTO credit_transactions (user_id, amount, action, description, granted_by)
  VALUES (p_target_user_id, p_amount, 'admin_grant', p_description, v_admin_id);
  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (v_admin_id, 'grant_credits', 'user', p_target_user_id::text,
    jsonb_build_object('amount', p_amount, 'description', p_description));
  RETURN jsonb_build_object('success', true);
END;
$$;

-- 9. Admin: Activate Subscription
CREATE OR REPLACE FUNCTION public.admin_activate_subscription(
  p_target_user_id uuid,
  p_plan_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_plan subscription_plans%ROWTYPE;
  v_expires_at timestamptz;
BEGIN
  IF NOT has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  SELECT * INTO v_plan FROM subscription_plans WHERE id = p_plan_id;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_not_found');
  END IF;
  v_expires_at := now() + (p_days || ' days')::interval;
  UPDATE user_subscriptions SET status = 'expired', updated_at = now()
    WHERE user_id = p_target_user_id AND status = 'active';
  INSERT INTO user_subscriptions (user_id, plan_id, status, starts_at, expires_at, activated_by)
  VALUES (p_target_user_id, p_plan_id, 'active', now(), v_expires_at, v_admin_id);
  UPDATE user_credits SET balance = balance + v_plan.credits_per_month, total_earned = total_earned + v_plan.credits_per_month, updated_at = now()
    WHERE user_id = p_target_user_id;
  INSERT INTO credit_transactions (user_id, amount, action, description, granted_by)
  VALUES (p_target_user_id, v_plan.credits_per_month, 'subscription_grant',
    'اشتراك ' || v_plan.name_ar || ' (' || p_days || ' يوم)', v_admin_id);
  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (v_admin_id, 'activate_subscription', 'user', p_target_user_id::text,
    jsonb_build_object('plan_id', p_plan_id, 'plan_name', v_plan.name, 'days', p_days, 'credits', v_plan.credits_per_month));
  RETURN jsonb_build_object('success', true, 'expires_at', v_expires_at);
END;
$$;

-- 10. Admin: Handle Trial
CREATE OR REPLACE FUNCTION public.admin_handle_trial(
  p_trial_id uuid,
  p_approve boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_trial trial_requests%ROWTYPE;
  v_credits integer;
BEGIN
  IF NOT has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  SELECT * INTO v_trial FROM trial_requests WHERE id = p_trial_id;
  IF v_trial IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'trial_not_found');
  END IF;
  IF v_trial.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_reviewed');
  END IF;
  UPDATE trial_requests SET
    status = CASE WHEN p_approve THEN 'approved'::trial_status ELSE 'rejected'::trial_status END,
    reviewed_by = v_admin_id, reviewed_at = now()
  WHERE id = p_trial_id;
  IF p_approve THEN
    v_credits := COALESCE(v_trial.trial_credits, 50);
    UPDATE user_credits SET balance = balance + v_credits, total_earned = total_earned + v_credits, updated_at = now()
      WHERE user_id = v_trial.user_id;
    INSERT INTO credit_transactions (user_id, amount, action, description, granted_by)
    VALUES (v_trial.user_id, v_credits, 'trial_grant', 'فترة تجريبية', v_admin_id);
  END IF;
  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (v_admin_id, CASE WHEN p_approve THEN 'approve_trial' ELSE 'reject_trial' END,
    'trial_request', p_trial_id::text,
    jsonb_build_object('user_id', v_trial.user_id, 'approved', p_approve));
  RETURN jsonb_build_object('success', true);
END;
$$;
