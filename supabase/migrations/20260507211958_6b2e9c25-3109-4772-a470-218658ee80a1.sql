
CREATE OR REPLACE FUNCTION public.enforce_subscription_expiry()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expired_count integer := 0;
  v_zeroed_count integer := 0;
  v_sub RECORD;
  v_plan_name text;
  v_balance integer;
BEGIN
  FOR v_sub IN
    SELECT us.id, us.user_id, us.plan_id
    FROM user_subscriptions us
    WHERE us.status = 'active'
      AND us.expires_at IS NOT NULL
      AND us.expires_at <= now()
    FOR UPDATE
  LOOP
    UPDATE user_subscriptions
      SET status = 'expired', updated_at = now()
      WHERE id = v_sub.id;
    v_expired_count := v_expired_count + 1;

    SELECT name_ar INTO v_plan_name FROM subscription_plans WHERE id = v_sub.plan_id;

    IF NOT EXISTS (
      SELECT 1 FROM user_subscriptions
      WHERE user_id = v_sub.user_id
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      SELECT balance INTO v_balance FROM user_credits
        WHERE user_id = v_sub.user_id FOR UPDATE;

      IF COALESCE(v_balance, 0) > 0 THEN
        UPDATE user_credits
          SET balance = 0,
              total_spent = total_spent + v_balance,
              updated_at = now()
          WHERE user_id = v_sub.user_id;

        INSERT INTO credit_transactions (user_id, amount, action, description)
        VALUES (v_sub.user_id, v_balance, 'spent',
          'تصفير الرصيد - انتهاء صلاحية الاشتراك (' || COALESCE(v_plan_name, '') || ')');

        v_zeroed_count := v_zeroed_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'expired_count', v_expired_count,
    'zeroed_count', v_zeroed_count,
    'checked_at', now()
  );
END;
$function$;

SELECT public.enforce_subscription_expiry();
