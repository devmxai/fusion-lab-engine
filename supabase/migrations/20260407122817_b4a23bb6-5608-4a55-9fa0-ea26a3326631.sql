
-- Deactivate old fixed-duration Grok rules
UPDATE pricing_rules SET status = 'inactive' 
WHERE model IN ('grok-imagine/text-to-video', 'grok-imagine/image-to-video') 
AND status = 'active';

-- Insert per_second Grok text-to-video rules (2.5cr/s for 480p, 5cr/s for 720p)
INSERT INTO pricing_rules (model, provider, generation_type, resolution, quality, price_credits, price_unit, status, display_name) VALUES
('grok-imagine/text-to-video', 'grok', 'video', '480p', 'normal', 2.5, 'per_second', 'active', 'Grok Video 480p'),
('grok-imagine/text-to-video', 'grok', 'video', '480p', 'fun', 2.5, 'per_second', 'active', 'Grok Video 480p Fun'),
('grok-imagine/text-to-video', 'grok', 'video', '480p', 'spicy', 2.5, 'per_second', 'active', 'Grok Video 480p Spicy'),
('grok-imagine/text-to-video', 'grok', 'video', '720p', 'normal', 5, 'per_second', 'active', 'Grok Video 720p'),
('grok-imagine/text-to-video', 'grok', 'video', '720p', 'fun', 5, 'per_second', 'active', 'Grok Video 720p Fun'),
('grok-imagine/text-to-video', 'grok', 'video', '720p', 'spicy', 5, 'per_second', 'active', 'Grok Video 720p Spicy'),
('grok-imagine/image-to-video', 'grok', 'video', '480p', 'normal', 2.5, 'per_second', 'active', 'Grok I2V 480p'),
('grok-imagine/image-to-video', 'grok', 'video', '480p', 'fun', 2.5, 'per_second', 'active', 'Grok I2V 480p Fun'),
('grok-imagine/image-to-video', 'grok', 'video', '720p', 'normal', 5, 'per_second', 'active', 'Grok I2V 720p'),
('grok-imagine/image-to-video', 'grok', 'video', '720p', 'fun', 5, 'per_second', 'active', 'Grok I2V 720p Fun');
