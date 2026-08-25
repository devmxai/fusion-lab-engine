-- Add model_access for grok-imagine/image-to-video
INSERT INTO public.model_access (model, min_plan, is_active, provider, category, display_name)
VALUES ('grok-imagine/image-to-video', 'free', true, 'xAI', 'video', 'Grok Image to Video')
ON CONFLICT (model) DO UPDATE SET is_active = true;

-- Activate existing text-to-video pricing rules
UPDATE public.pricing_rules SET status = 'active' WHERE model = 'grok-imagine/text-to-video' AND status = 'pending_review';

-- Add pricing rules for image-to-video (same as text-to-video)
INSERT INTO public.pricing_rules (model, provider, generation_type, resolution, duration_seconds, price_credits, price_unit, status)
VALUES
  ('grok-imagine/image-to-video', 'xAI', 'image-to-video', '480p', 6, 15, 'per_generation', 'active'),
  ('grok-imagine/image-to-video', 'xAI', 'image-to-video', '480p', 10, 25, 'per_generation', 'active'),
  ('grok-imagine/image-to-video', 'xAI', 'image-to-video', '720p', 6, 30, 'per_generation', 'active'),
  ('grok-imagine/image-to-video', 'xAI', 'image-to-video', '720p', 10, 50, 'per_generation', 'active');

-- Add pricing_rule_access for the new image-to-video rules
INSERT INTO public.pricing_rule_access (pricing_rule_id, min_plan, is_active)
SELECT id, 'starter', true FROM public.pricing_rules WHERE model = 'grok-imagine/image-to-video';

-- Also ensure text-to-video rules have access entries
INSERT INTO public.pricing_rule_access (pricing_rule_id, min_plan, is_active)
SELECT id, 'starter', true FROM public.pricing_rules WHERE model = 'grok-imagine/text-to-video'
ON CONFLICT (pricing_rule_id) DO NOTHING;