
-- Fix Kling Avatar Standard: per_second at 8 credits, resolution=720p, has_audio=true
UPDATE pricing_rules 
SET price_unit = 'per_second', 
    price_credits = 8, 
    resolution = '720p', 
    has_audio = true, 
    status = 'active',
    display_name = 'Kling Avatar 720p',
    source_note = 'KIE.AI pricing: 8 credits/second for standard 720p',
    source_url = 'https://docs.kie.ai/market/kling/ai-avatar-standard',
    verified_at = now(),
    updated_at = now()
WHERE model = 'kling/ai-avatar-standard';

-- Fix Kling Avatar Pro: per_second at 16 credits, resolution=1080p, has_audio=true
UPDATE pricing_rules 
SET price_unit = 'per_second', 
    price_credits = 16, 
    resolution = '1080p', 
    has_audio = true, 
    status = 'active',
    display_name = 'Kling Avatar 1080p',
    source_note = 'KIE.AI pricing: 16 credits/second for pro 1080p',
    source_url = 'https://docs.kie.ai/market/kling/ai-avatar-pro',
    verified_at = now(),
    updated_at = now()
WHERE model = 'kling/ai-avatar-pro';

-- Fix Infinitalk: add has_audio=true
UPDATE pricing_rules 
SET has_audio = true,
    verified_at = now(),
    updated_at = now()
WHERE model = 'infinitalk/from-audio';

-- Activate Wan Animate
UPDATE pricing_rules 
SET status = 'active',
    updated_at = now()
WHERE model = 'wan/2-2-animate-move' AND status = 'pending_review';
