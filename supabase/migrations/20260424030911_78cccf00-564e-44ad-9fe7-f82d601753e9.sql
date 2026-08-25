-- GPT Image 2: replace flat pricing with per-resolution tiers (1K=6, 2K=10, 4K=16)
DELETE FROM pricing_rules WHERE model IN ('gpt-image-2-text-to-image','gpt-image-2-image-to-image');

INSERT INTO pricing_rules (provider, model, generation_type, resolution, price_credits, price_unit, status, display_name, source_note, verified_at)
VALUES
  ('openai', 'gpt-image-2-text-to-image',  'image', '1K', 6,  'per_generation', 'verified', 'GPT Image 2 — 1K', 'KIE pricing tier', now()),
  ('openai', 'gpt-image-2-text-to-image',  'image', '2K', 10, 'per_generation', 'verified', 'GPT Image 2 — 2K', 'KIE pricing tier', now()),
  ('openai', 'gpt-image-2-text-to-image',  'image', '4K', 16, 'per_generation', 'verified', 'GPT Image 2 — 4K', 'KIE pricing tier', now()),
  ('openai', 'gpt-image-2-image-to-image', 'image', '1K', 6,  'per_generation', 'verified', 'GPT Image 2 Edit — 1K', 'KIE pricing tier', now()),
  ('openai', 'gpt-image-2-image-to-image', 'image', '2K', 10, 'per_generation', 'verified', 'GPT Image 2 Edit — 2K', 'KIE pricing tier', now()),
  ('openai', 'gpt-image-2-image-to-image', 'image', '4K', 16, 'per_generation', 'verified', 'GPT Image 2 Edit — 4K', 'KIE pricing tier', now());

-- Allow access for all plans
INSERT INTO pricing_rule_access (pricing_rule_id, min_plan, is_active)
SELECT id, 'free', true FROM pricing_rules
WHERE model IN ('gpt-image-2-text-to-image','gpt-image-2-image-to-image')
ON CONFLICT (pricing_rule_id) DO UPDATE SET min_plan='free', is_active=true;