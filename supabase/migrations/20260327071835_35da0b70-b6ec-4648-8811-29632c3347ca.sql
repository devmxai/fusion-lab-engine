
-- Function for super_admin to assign/remove admin role
CREATE OR REPLACE FUNCTION public.admin_set_role(p_target_user_id uuid, p_role app_role)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_target_email text;
BEGIN
  -- Only super_admin can manage roles
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_admin_id AND role = 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized', 'message', 'فقط المسؤول الرئيسي يمكنه تعديل الأدوار');
  END IF;

  -- Cannot change own role
  IF v_admin_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_change_self');
  END IF;

  -- Cannot assign super_admin
  IF p_role = 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_assign_super_admin');
  END IF;

  SELECT email INTO v_target_email FROM profiles WHERE id = p_target_user_id;

  -- Update role
  UPDATE user_roles SET role = p_role WHERE user_id = p_target_user_id;

  INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
  VALUES (v_admin_id, 'set_role', 'user', p_target_user_id::text,
    jsonb_build_object('new_role', p_role::text, 'email', v_target_email));

  RETURN jsonb_build_object('success', true, 'new_role', p_role::text);
END;
$$;
