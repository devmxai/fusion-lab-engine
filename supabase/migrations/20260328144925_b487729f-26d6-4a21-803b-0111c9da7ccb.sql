
-- Wan 2.2 Animate Replace: same pricing as Move (6 cr/s @ 480p, 9.5 cr/s @ 580p, 12.5 cr/s @ 720p)
INSERT INTO public.pricing_rules (provider, model, generation_type, resolution, price_credits, price_unit, status, display_name)
VALUES
  ('Alibaba', 'wan/2-2-animate-replace', 'video', '480p', 6, 'per_second', 'active', 'Wan Animate Replace 480p'),
  ('Alibaba', 'wan/2-2-animate-replace', 'video', '580p', 10, 'per_second', 'active', 'Wan Animate Replace 580p'),
  ('Alibaba', 'wan/2-2-animate-replace', 'video', '720p', 13, 'per_second', 'active', 'Wan Animate Replace 720p')
ON CONFLICT DO NOTHING;

INSERT INTO public.model_access (model, provider, category, display_name, min_plan, is_active)
VALUES
  ('wan/2-2-animate-replace', 'Alibaba', 'ترانسفير', 'Wan Animate Replace', 'starter', true)
ON CONFLICT (model) DO UPDATE SET category = EXCLUDED.category, display_name = EXCLUDED.display_name, is_active = EXCLUDED.is_active;
