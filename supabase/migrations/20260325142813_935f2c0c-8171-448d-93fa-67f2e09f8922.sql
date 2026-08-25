
-- =============================================
-- Phase 1: Entitlements + Generation Orchestrator
-- =============================================

-- 1. Plan Entitlements Table
CREATE TABLE IF NOT EXISTS public.plan_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_type text NOT NULL UNIQUE,
  max_image_resolution text DEFAULT '2K',
  max_video_resolution text DEFAULT '720p',
  max_video_duration_seconds integer DEFAULT 10,
  daily_generation_limit integer DEFAULT 10,
  features jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone reads entitlements" ON public.plan_entitlements
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Admins manage entitlements" ON public.plan_entitlements
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Model Access Control Table
CREATE TABLE IF NOT EXISTS public.model_access (
  model text PRIMARY KEY,
  min_plan text NOT NULL DEFAULT 'free',
  display_name text,
  provider text,
  category text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.model_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone reads model_access" ON public.model_access
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Admins manage model_access" ON public.model_access
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Seed plan_entitlements
INSERT INTO public.plan_entitlements (plan_type, max_image_resolution, max_video_resolution, max_video_duration_seconds, daily_generation_limit, features) VALUES
  ('free',    '2K',  '720p',  10,   5, '{"description":"خطة مجانية"}'),
  ('starter', '4K',  '720p',  10,  20, '{"description":"خطة المبتدئين"}'),
  ('plus',    '4K',  '1080p', 12,  50, '{"description":"خطة بلس"}'),
  ('pro',     '4K',  '1080p', 15, 100, '{"description":"خطة احترافية"}')
ON CONFLICT (plan_type) DO NOTHING;

-- 4. Seed model_access
INSERT INTO public.model_access (model, min_plan, display_name, provider, category) VALUES
  ('z-image', 'free', 'Z Image', 'KIE.AI', 'صور'),
  ('nano-banana-2', 'free', 'Nano Banana 2', 'Google', 'صور'),
  ('nano-banana-pro', 'plus', 'Nano Banana Pro', 'Google', 'صور'),
  ('seedream/5-lite-text-to-image', 'free', 'Seedream 5 Lite', 'Bytedance', 'صور'),
  ('seedream/4.5-text-to-image', 'free', 'Seedream 4.5', 'Bytedance', 'صور'),
  ('flux-2/pro-text-to-image', 'plus', 'Flux 2 Pro', 'Flux', 'صور'),
  ('grok-imagine/text-to-image', 'free', 'Grok Imagine', 'xAI', 'صور'),
  ('google/nano-banana-edit', 'free', 'Nano Banana Edit', 'Google', 'ريمكس'),
  ('flux-kontext-pro', 'free', 'Flux Kontext Pro', 'Flux', 'ريمكس'),
  ('flux-kontext-max', 'plus', 'Flux Kontext Max', 'Flux', 'ريمكس'),
  ('qwen/image-edit', 'free', 'Qwen Image Edit', 'Alibaba', 'ريمكس'),
  ('gpt-image/1.5-image-to-image', 'plus', 'GPT Image 1.5', 'OpenAI', 'ريمكس'),
  ('seedream/4.5-edit', 'free', 'Seedream 4.5 Edit', 'Bytedance', 'ريمكس'),
  ('grok-imagine/text-to-video', 'free', 'Grok Video', 'xAI', 'فيديو'),
  ('veo3_fast', 'free', 'Veo 3.1 Fast', 'Google', 'فيديو'),
  ('veo3', 'plus', 'Veo 3.1 Quality', 'Google', 'فيديو'),
  ('kling-3.0', 'free', 'Kling 3.0', 'Kling', 'فيديو'),
  ('kling-2.6/text-to-video', 'free', 'Kling 2.6', 'Kling', 'فيديو'),
  ('kling/v2-1-master-text-to-video', 'plus', 'Kling 2.1 Master', 'Kling', 'فيديو'),
  ('bytedance/seedance-1.5-pro', 'plus', 'Seedance 1.5 Pro', 'Bytedance', 'فيديو'),
  ('bytedance/v1-pro-text-to-video', 'free', 'Seedance V1 Pro', 'Bytedance', 'فيديو'),
  ('sora-2-text-to-video', 'plus', 'Sora 2', 'OpenAI', 'فيديو'),
  ('wan/2-6-text-to-video', 'free', 'Wan 2.6', 'Alibaba', 'فيديو'),
  ('kling/ai-avatar-standard', 'free', 'Kling Avatar', 'Kling', 'افتار'),
  ('kling/ai-avatar-pro', 'plus', 'Kling Avatar Pro', 'Kling', 'افتار'),
  ('infinitalk/from-audio', 'free', 'Infinitalk', 'Infinitalk', 'افتار'),
  ('wan/2-2-animate-move', 'free', 'Wan Animate', 'Alibaba', 'افتار'),
  ('recraft/remove-background', 'free', 'Remove Background', 'Recraft', 'حذف الخلفية'),
  ('recraft/crisp-upscale', 'free', 'Recraft Crisp Upscale', 'Recraft', 'رفع الجودة'),
  ('topaz/image-upscale', 'plus', 'Topaz Upscale', 'Topaz', 'رفع الجودة'),
  ('gemini-tts', 'free', 'Gemini TTS', 'Google', 'صوت')
ON CONFLICT (model) DO NOTHING;

-- 5. Check Entitlement Function
CREATE OR REPLACE FUNCTION public.check_entitlement(
  p_user_id uuid,
  p_model text,
  p_resolution text DEFAULT NULL,
  p_duration_seconds integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_plan text;
  v_min_plan text;
  v_ent plan_entitlements%ROWTYPE;
  v_daily_count integer;
  v_plan_rank integer;
  v_min_rank integer;
BEGIN
  SELECT sp.type::text INTO v_user_plan
  FROM user_subscriptions us
  JOIN subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = p_user_id
    AND us.status = 'active'
    AND (us.expires_at IS NULL OR us.expires_at > now())
  ORDER BY us.created_at DESC LIMIT 1;

  v_user_plan := COALESCE(v_user_plan, 'free');

  SELECT ma.min_plan INTO v_min_plan
  FROM model_access ma WHERE ma.model = p_model AND ma.is_active = true;

  IF v_min_plan IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'model_not_found', 'plan', v_user_plan);
  END IF;

  v_plan_rank := CASE v_user_plan WHEN 'pro' THEN 3 WHEN 'plus' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END;
  v_min_rank := CASE v_min_plan WHEN 'pro' THEN 3 WHEN 'plus' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END;

  IF v_plan_rank < v_min_rank THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'plan_upgrade_required', 'plan', v_user_plan, 'required_plan', v_min_plan);
  END IF;

  SELECT * INTO v_ent FROM plan_entitlements WHERE plan_type = v_user_plan;
  IF v_ent IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_entitlement_config', 'plan', v_user_plan);
  END IF;

  SELECT COUNT(*) INTO v_daily_count FROM generations
  WHERE user_id = p_user_id AND created_at > (now() - interval '24 hours');

  IF v_daily_count >= v_ent.daily_generation_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'daily_limit_reached', 'plan', v_user_plan,
      'limit', v_ent.daily_generation_limit, 'used', v_daily_count);
  END IF;

  IF p_duration_seconds IS NOT NULL AND v_ent.max_video_duration_seconds IS NOT NULL
     AND p_duration_seconds > v_ent.max_video_duration_seconds THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'duration_exceeded', 'plan', v_user_plan,
      'max_duration', v_ent.max_video_duration_seconds);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'plan', v_user_plan,
    'daily_remaining', v_ent.daily_generation_limit - v_daily_count);
END;
$$;

-- 6. Server-side Price Calculator
CREATE OR REPLACE FUNCTION public.server_calculate_price(
  p_model text,
  p_resolution text DEFAULT NULL,
  p_quality text DEFAULT NULL,
  p_duration_seconds integer DEFAULT NULL,
  p_has_audio boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  v_credits := round(v_credits, 1);

  RETURN jsonb_build_object(
    'found', true, 'credits', v_credits, 'rule_id', v_final_rule.id,
    'price_unit', v_final_rule.price_unit, 'base_price', v_final_rule.price_credits
  );
END;
$$;

-- 7. Validate and Reserve (atomic: entitlement + price + reservation)
CREATE OR REPLACE FUNCTION public.validate_and_reserve(
  p_model text,
  p_tool_id text,
  p_resolution text DEFAULT NULL,
  p_quality text DEFAULT NULL,
  p_duration_seconds integer DEFAULT NULL,
  p_has_audio boolean DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
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

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM credit_reservations
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id AND status = 'reserved';
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'reservation_id', v_existing_id, 'idempotent', true);
    END IF;
  END IF;

  v_entitlement := check_entitlement(v_user_id, p_model, p_resolution, p_duration_seconds);
  IF NOT (v_entitlement->>'allowed')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', 'entitlement_denied', 'details', v_entitlement);
  END IF;

  v_pricing := server_calculate_price(p_model, p_resolution, p_quality, p_duration_seconds, p_has_audio);
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
$$;
