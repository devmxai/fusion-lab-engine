
-- Add is_banned column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned boolean DEFAULT false;

-- Create admin function to ban/unban user
CREATE OR REPLACE FUNCTION public.admin_ban_user(p_target_user_id uuid, p_ban boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_target_email text;
BEGIN
  IF NOT has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF v_admin_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_ban_self');
  END IF;

  -- Cannot ban admins
  IF has_role(p_target_user_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_ban_admin');
  END IF;

  SELECT email INTO v_target_email FROM profiles WHERE id = p_target_user_id;

  UPDATE profiles SET is_banned = p_ban, updated_at = now() WHERE id = p_target_user_id;

  -- If banning, expire active subscriptions
  IF p_ban THEN
    UPDATE user_subscriptions SET status = 'cancelled', updated_at = now()
      WHERE user_id = p_target_user_id AND status = 'active';
  END IF;

  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (v_admin_id, CASE WHEN p_ban THEN 'ban_user' ELSE 'unban_user' END, 'user', p_target_user_id::text,
    jsonb_build_object('email', v_target_email, 'banned', p_ban));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Create admin function to reset user credits to 0
CREATE OR REPLACE FUNCTION public.admin_reset_credits(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_old_balance integer;
BEGIN
  IF NOT has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT balance INTO v_old_balance FROM user_credits WHERE user_id = p_target_user_id;

  UPDATE user_credits SET balance = 0, updated_at = now() WHERE user_id = p_target_user_id;

  INSERT INTO credit_transactions (user_id, amount, action, description, granted_by)
  VALUES (p_target_user_id, COALESCE(v_old_balance, 0), 'spent', 'إعادة تعيين الرصيد بواسطة الإدارة', v_admin_id);

  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (v_admin_id, 'reset_credits', 'user', p_target_user_id::text,
    jsonb_build_object('old_balance', v_old_balance));

  RETURN jsonb_build_object('success', true, 'old_balance', v_old_balance);
END;
$$;

-- Create admin function to cancel subscription
CREATE OR REPLACE FUNCTION public.admin_cancel_subscription(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_count integer;
BEGIN
  IF NOT has_role(v_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  UPDATE user_subscriptions SET status = 'cancelled', updated_at = now()
    WHERE user_id = p_target_user_id AND status = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (v_admin_id, 'cancel_subscription', 'user', p_target_user_id::text,
    jsonb_build_object('cancelled_count', v_count));

  RETURN jsonb_build_object('success', true, 'cancelled', v_count);
END;
$$;
