DELETE FROM public.model_cards WHERE tool_id = 'sora-2';
DELETE FROM public.model_access WHERE model = 'sora-2-text-to-video';
DELETE FROM public.pricing_rules WHERE model = 'sora-2-text-to-video';