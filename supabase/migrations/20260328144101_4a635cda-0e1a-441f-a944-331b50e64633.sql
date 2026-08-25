
-- Kling 3.0 Motion Control: 20 credits/s @ 720p, 27 credits/s @ 1080p
INSERT INTO public.pricing_rules (provider, model, generation_type, resolution, price_credits, price_unit, status, display_name)
VALUES
  ('Kling', 'kling-3.0/motion-control', 'video', '720p', 20, 'per_second', 'active', 'Kling 3.0 Motion 720p'),
  ('Kling', 'kling-3.0/motion-control', 'video', '1080p', 27, 'per_second', 'active', 'Kling 3.0 Motion 1080p')
ON CONFLICT DO NOTHING;

-- Kling 2.6 Motion Control: 6 credits/s @ 720p, 9 credits/s @ 1080p
INSERT INTO public.pricing_rules (provider, model, generation_type, resolution, price_credits, price_unit, status, display_name)
VALUES
  ('Kling', 'kling-2.6/motion-control', 'video', '720p', 6, 'per_second', 'active', 'Kling 2.6 Motion 720p'),
  ('Kling', 'kling-2.6/motion-control', 'video', '1080p', 9, 'per_second', 'active', 'Kling 2.6 Motion 1080p')
ON CONFLICT DO NOTHING;

-- Model access entries
INSERT INTO public.model_access (model, provider, category, display_name, min_plan, is_active)
VALUES
  ('kling-3.0/motion-control', 'Kling', 'ترانسفير', 'Kling 3.0 Motion', 'starter', true),
  ('kling-2.6/motion-control', 'Kling', 'ترانسفير', 'Kling 2.6 Motion', 'starter', true)
ON CONFLICT (model) DO UPDATE SET category = EXCLUDED.category, display_name = EXCLUDED.display_name, is_active = EXCLUDED.is_active;
