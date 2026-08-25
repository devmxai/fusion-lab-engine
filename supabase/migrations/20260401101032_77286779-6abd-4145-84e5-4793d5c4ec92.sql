WITH target_rules(pricing_rule_id) AS (
  VALUES
    ('dfc36da7-a062-4ca9-83f7-cbc38b7f32c2'::uuid),
    ('485d07d5-a22a-4c5c-a6ee-dfb2c6b3fedd'::uuid),
    ('826539a3-78eb-4fb5-bce6-93dd8fd7785f'::uuid),
    ('b11e3ee8-695a-4425-b980-711ac28aea64'::uuid)
)
INSERT INTO pricing_rule_access (pricing_rule_id, min_plan, is_active)
SELECT target_rules.pricing_rule_id, 'free', true
FROM target_rules
JOIN pricing_rules ON pricing_rules.id = target_rules.pricing_rule_id
ON CONFLICT (pricing_rule_id) DO UPDATE SET min_plan = 'free', is_active = true;
