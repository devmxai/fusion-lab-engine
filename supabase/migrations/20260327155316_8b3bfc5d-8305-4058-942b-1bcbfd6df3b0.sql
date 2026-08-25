-- Per-pricing-rule access control to avoid changing whole model families
CREATE TABLE IF NOT EXISTS public.pricing_rule_access (
  pricing_rule_id UUID PRIMARY KEY REFERENCES public.pricing_rules(id) ON DELETE CASCADE,
  min_plan TEXT NOT NULL DEFAULT 'free',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_rule_access ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pricing_rule_access'
      AND policyname = 'Admins manage pricing_rule_access'
  ) THEN
    CREATE POLICY "Admins manage pricing_rule_access"
    ON public.pricing_rule_access
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pricing_rule_access'
      AND policyname = 'Anyone reads pricing_rule_access'
  ) THEN
    CREATE POLICY "Anyone reads pricing_rule_access"
    ON public.pricing_rule_access
    FOR SELECT
    TO anon, authenticated
    USING (true);
  END IF;
END
$$;

-- Main entitlement function (variant-aware by pricing rule)
CREATE OR REPLACE FUNCTION public.check_entitlement(
  p_user_id uuid,
  p_model text,
  p_resolution text DEFAULT NULL::text,
  p_duration_seconds integer DEFAULT NULL::integer,
  p_quality text DEFAULT NULL::text,
  p_generation_type text DEFAULT 'default'::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_plan text;
  v_min_plan text;
  v_ent plan_entitlements%ROWTYPE;
  v_daily_count integer;
  v_plan_rank integer;
  v_min_rank integer;
  v_model_category text;

  v_rule RECORD;
  v_best_rule_id uuid;
  v_best_score integer := -1;
  v_score integer;
  v_disqualified boolean;

  v_req_rank integer;
  v_max_rank integer;
  v_req_vrank integer;
  v_max_vrank integer;
  v_req_qrank integer;
  v_max_qrank integer;
BEGIN
  -- User current plan
  SELECT sp.type::text INTO v_user_plan
  FROM user_subscriptions us
  JOIN subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = p_user_id
    AND us.status = 'active'
    AND (us.expires_at IS NULL OR us.expires_at > now())
  ORDER BY us.created_at DESC
  LIMIT 1;

  v_user_plan := COALESCE(v_user_plan, 'free');

  -- Find best matching active pricing rule for this exact variant
  FOR v_rule IN
    SELECT *
    FROM pricing_rules
    WHERE model = p_model
      AND status = 'active'
  LOOP
    v_score := 0;
    v_disqualified := false;

    IF v_rule.resolution IS NOT NULL THEN
      IF p_resolution IS NOT NULL AND lower(v_rule.resolution) = lower(p_resolution) THEN
        v_score := v_score + 10;
      ELSE
        v_disqualified := true;
      END IF;
    END IF;

    IF v_rule.quality IS NOT NULL THEN
      IF p_quality IS NOT NULL AND lower(v_rule.quality) = lower(p_quality) THEN
        v_score := v_score + 10;
      ELSE
        v_disqualified := true;
      END IF;
    END IF;

    IF v_rule.duration_seconds IS NOT NULL THEN
      IF p_duration_seconds IS NOT NULL AND v_rule.duration_seconds = p_duration_seconds THEN
        v_score := v_score + 10;
      ELSE
        v_disqualified := true;
      END IF;
    END IF;

    IF NOT v_disqualified AND v_score > v_best_score THEN
      v_best_score := v_score;
      v_best_rule_id := v_rule.id;
    END IF;
  END LOOP;

  -- Fallback generic active rule for the model
  IF v_best_rule_id IS NULL THEN
    SELECT id INTO v_best_rule_id
    FROM pricing_rules
    WHERE model = p_model
      AND status = 'active'
      AND resolution IS NULL
      AND quality IS NULL
      AND duration_seconds IS NULL
      AND has_audio IS NULL
    LIMIT 1;
  END IF;

  -- Variant-specific min_plan first
  IF v_best_rule_id IS NOT NULL THEN
    SELECT pra.min_plan INTO v_min_plan
    FROM pricing_rule_access pra
    WHERE pra.pricing_rule_id = v_best_rule_id
      AND pra.is_active = true;
  END IF;

  -- Fallback to old model-level access (backward compatibility)
  IF v_min_plan IS NULL THEN
    SELECT ma.min_plan, ma.category INTO v_min_plan, v_model_category
    FROM model_access ma
    WHERE ma.model = p_model
      AND ma.is_active = true;
  END IF;

  IF v_min_plan IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'model_not_found', 'plan', v_user_plan);
  END IF;

  v_plan_rank := CASE v_user_plan WHEN 'pro' THEN 3 WHEN 'plus' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END;
  v_min_rank := CASE v_min_plan WHEN 'pro' THEN 3 WHEN 'plus' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END;

  IF v_plan_rank < v_min_rank THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'plan_upgrade_required',
      'plan', v_user_plan,
      'required_plan', v_min_plan
    );
  END IF;

  -- Entitlements
  SELECT * INTO v_ent
  FROM plan_entitlements
  WHERE plan_type = v_user_plan;

  IF v_ent IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_entitlement_config', 'plan', v_user_plan);
  END IF;

  SELECT COUNT(*) INTO v_daily_count
  FROM generations
  WHERE user_id = p_user_id
    AND created_at > (now() - interval '24 hours');

  IF v_ent.daily_generation_limit IS NOT NULL AND v_daily_count >= v_ent.daily_generation_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit_reached',
      'plan', v_user_plan,
      'limit', v_ent.daily_generation_limit,
      'used', v_daily_count
    );
  END IF;

  IF p_duration_seconds IS NOT NULL
     AND v_ent.max_video_duration_seconds IS NOT NULL
     AND p_duration_seconds > v_ent.max_video_duration_seconds THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'duration_exceeded',
      'plan', v_user_plan,
      'max_duration', v_ent.max_video_duration_seconds
    );
  END IF;

  IF p_resolution IS NOT NULL AND v_model_category IN ('image', 'remix', 'upscale') THEN
    IF v_ent.max_image_resolution IS NOT NULL THEN
      v_req_rank := CASE lower(p_resolution)
        WHEN '1k' THEN 1 WHEN '2k' THEN 2 WHEN '4k' THEN 3 WHEN '8k' THEN 4 ELSE 1 END;
      v_max_rank := CASE lower(v_ent.max_image_resolution)
        WHEN '1k' THEN 1 WHEN '2k' THEN 2 WHEN '4k' THEN 3 WHEN '8k' THEN 4 ELSE 2 END;

      IF v_req_rank > v_max_rank THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'image_resolution_exceeded',
          'plan', v_user_plan,
          'max_resolution', v_ent.max_image_resolution,
          'requested', p_resolution
        );
      END IF;
    END IF;
  END IF;

  IF p_resolution IS NOT NULL AND v_model_category IN ('video', 'avatar') THEN
    IF v_ent.max_video_resolution IS NOT NULL THEN
      v_req_vrank := CASE lower(p_resolution)
        WHEN '360p' THEN 1 WHEN '480p' THEN 2 WHEN '720p' THEN 3 WHEN '1080p' THEN 4 WHEN '4k' THEN 5 ELSE 2 END;
      v_max_vrank := CASE lower(v_ent.max_video_resolution)
        WHEN '360p' THEN 1 WHEN '480p' THEN 2 WHEN '720p' THEN 3 WHEN '1080p' THEN 4 WHEN '4k' THEN 5 ELSE 3 END;

      IF v_req_vrank > v_max_vrank THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'video_resolution_exceeded',
          'plan', v_user_plan,
          'max_resolution', v_ent.max_video_resolution,
          'requested', p_resolution
        );
      END IF;
    END IF;
  END IF;

  IF v_ent.features IS NOT NULL AND v_ent.features != '{}'::jsonb THEN
    IF p_generation_type = 'audio' AND NOT COALESCE((v_ent.features->>'audio_enabled')::boolean, true) THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'feature_not_available', 'plan', v_user_plan, 'feature', 'audio');
    END IF;

    IF p_quality IS NOT NULL AND v_ent.features ? 'max_quality' THEN
      v_req_qrank := CASE lower(p_quality)
        WHEN 'basic' THEN 1 WHEN 'std' THEN 2 WHEN 'standard' THEN 2 WHEN 'high' THEN 3 WHEN 'ultra' THEN 4 ELSE 2 END;
      v_max_qrank := CASE lower(v_ent.features->>'max_quality')
        WHEN 'basic' THEN 1 WHEN 'std' THEN 2 WHEN 'standard' THEN 2 WHEN 'high' THEN 3 WHEN 'ultra' THEN 4 ELSE 3 END;

      IF v_req_qrank > v_max_qrank THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'quality_exceeded',
          'plan', v_user_plan,
          'max_quality', v_ent.features->>'max_quality',
          'requested', p_quality
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'plan', v_user_plan,
    'daily_remaining', COALESCE(v_ent.daily_generation_limit, 999) - v_daily_count
  );
END;
$function$;

-- Backward-compatible overload
CREATE OR REPLACE FUNCTION public.check_entitlement(
  p_user_id uuid,
  p_model text,
  p_resolution text DEFAULT NULL::text,
  p_duration_seconds integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.check_entitlement(
    p_user_id,
    p_model,
    p_resolution,
    p_duration_seconds,
    NULL::text,
    'default'::text
  );
$function$;