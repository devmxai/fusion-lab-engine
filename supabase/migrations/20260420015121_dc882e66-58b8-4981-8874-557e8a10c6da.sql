INSERT INTO public.pricing_rules (model, provider, generation_type, price_credits, price_unit, status, display_name, source_note)
VALUES ('gemini-tts-pro', 'google', 'tts', 0.015, 'per_character', 'active', 'Gemini 3.1 Flash TTS - Fusion Voice Pro', 'Latest Google TTS model with Audio Tags support')
ON CONFLICT DO NOTHING;

INSERT INTO public.model_access (model, provider, min_plan, is_active, category, display_name)
VALUES ('gemini-tts-pro', 'Google', 'free', true, 'صوت', 'Gemini TTS Pro')
ON CONFLICT (model) DO NOTHING;

INSERT INTO public.pricing_rule_access (pricing_rule_id, min_plan, is_active)
SELECT id, 'free', true FROM public.pricing_rules WHERE model = 'gemini-tts-pro'
ON CONFLICT (pricing_rule_id) DO NOTHING;