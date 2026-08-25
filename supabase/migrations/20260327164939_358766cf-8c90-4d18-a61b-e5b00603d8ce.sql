-- Update server_calculate_price to handle per_character pricing
CREATE OR REPLACE FUNCTION public.server_calculate_price(
  p_model text,
  p_resolution text DEFAULT NULL,
  p_quality text DEFAULT NULL,
  p_duration_seconds integer DEFAULT NULL,
  p_has_audio boolean DEFAULT NULL,
  p_character_count integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rule RECORD;
  v_best_rule_id uuid;
  v_best_score integer := -1;
  v_score integer;
  v_disqualified boolean;
  v_credits numeric;
  v_final_rule RECORD;
BEGIN
  FOR v_rule IN SELECT * FROM pricing_rules WHERE model = p_model AND status = 'active' LOOP
    v_score := 0;
    v_disqualified := false;

    IF v_rule.resolution IS NOT NULL THEN
      IF p_resolution IS NOT NULL AND lower(v_rule.resolution) = lower(p_resolution) THEN v_score := v_score + 10;
      ELSE v_disqualified := true; END IF;
    END IF;

    IF v_rule.quality IS NOT NULL THEN
      IF p_quality IS NOT NULL AND lower(v_rule.quality) = lower(p_quality) THEN v_score := v_score + 10;
      ELSE v_disqualified := true; END IF;
    END IF;

    IF v_rule.duration_seconds IS NOT NULL THEN
      IF p_duration_seconds IS NOT NULL AND v_rule.duration_seconds = p_duration_seconds THEN v_score := v_score + 10;
      ELSE v_disqualified := true; END IF;
    END IF;

    IF v_rule.has_audio IS NOT NULL THEN
      IF p_has_audio IS NOT NULL AND v_rule.has_audio = p_has_audio THEN v_score := v_score + 10;
      ELSE v_disqualified := true; END IF;
    END IF;

    IF NOT v_disqualified AND v_score > v_best_score THEN
      v_best_score := v_score;
      v_best_rule_id := v_rule.id;
    END IF;
  END LOOP;

  IF v_best_rule_id IS NULL THEN
    SELECT id INTO v_best_rule_id FROM pricing_rules
    WHERE model = p_model AND status = 'active'
      AND resolution IS NULL AND quality IS NULL AND duration_seconds IS NULL AND has_audio IS NULL
    LIMIT 1;
  END IF;

  IF v_best_rule_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'credits', 0);
  END IF;

  SELECT * INTO v_final_rule FROM pricing_rules WHERE id = v_best_rule_id;

  v_credits := v_final_rule.price_credits;
  IF v_final_rule.price_unit = 'per_second' AND p_duration_seconds IS NOT NULL THEN
    v_credits := v_final_rule.price_credits * p_duration_seconds;
  END IF;
  IF v_final_rule.price_unit = 'per_character' AND p_character_count IS NOT NULL THEN
    v_credits := v_final_rule.price_credits * p_character_count;
  END IF;
  v_credits := round(v_credits, 1);

  -- Minimum 1 credit for per_character if characters exist
  IF v_final_rule.price_unit = 'per_character' AND p_character_count IS NOT NULL AND p_character_count > 0 AND v_credits < 1 THEN
    v_credits := 1;
  END IF;

  RETURN jsonb_build_object(
    'found', true, 'credits', v_credits, 'rule_id', v_final_rule.id,
    'price_unit', v_final_rule.price_unit, 'base_price', v_final_rule.price_credits
  );
END;
$function$;

-- Update validate_and_reserve to pass character_count
CREATE OR REPLACE FUNCTION public.validate_and_reserve(
  p_model text,
  p_tool_id text,
  p_resolution text DEFAULT NULL,
  p_quality text DEFAULT NULL,
  p_duration_seconds integer DEFAULT NULL,
  p_has_audio boolean DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_generation_type text DEFAULT 'default',
  p_character_count integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    SELECT id INTO v_existing_id FROM credit_reservations
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id AND status = 'reserved';
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

  SELECT balance INTO v_balance FROM user_credits WHERE user_id = v_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_credit_record');
  END IF;
  IF v_balance < v_credits THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_credits', 'balance', v_balance, 'required', v_credits);
  END IF;

  v_snapshot := jsonb_build_object(
    'model', p_model, 'resolution', p_resolution, 'quality', p_quality,
    'durationSeconds', p_duration_seconds, 'hasAudio', p_has_audio,
    'characterCount', p_character_count,
    'credits', v_credits, 'priceUnit', v_pricing->>'price_unit',
    'ruleId', v_pricing->>'rule_id', 'calculatedAt', now()
  );

  UPDATE user_credits SET balance = balance - v_credits, updated_at = now() WHERE user_id = v_user_id;

  INSERT INTO credit_reservations (user_id, amount, tool_id, model, idempotency_key, pricing_snapshot, status)
  VALUES (v_user_id, v_credits, p_tool_id, p_model, p_idempotency_key, v_snapshot, 'reserved')
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'success', true, 'reservation_id', v_reservation_id,
    'credits_charged', v_credits, 'plan', v_entitlement->>'plan'
  );
END;
$function$;