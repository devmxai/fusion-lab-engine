INSERT INTO pricing_rules (model, provider, generation_type, price_credits, price_unit, display_name, source_url, source_note, status, verified_at)
VALUES
  ('veo3_lite', 'google', 'text-to-video', 30, 'per_generation', 'Veo 3.1 Lite', 'https://kie.ai/veo-3-1', 'Lite mode 720P=30, 1080P=35, 4K=150 (default 720p)', 'verified', now()),
  ('gpt-image-2-text-to-image', 'openai', 'text-to-image', 12, 'per_generation', 'GPT Image 2', 'https://kie.ai/gpt-image-2', '12 credits per image', 'verified', now()),
  ('gpt-image-2-image-to-image', 'openai', 'image-to-image', 12, 'per_generation', 'GPT Image 2 Edit', 'https://kie.ai/gpt-image-2', '12 credits per image', 'verified', now())
ON CONFLICT DO NOTHING;

INSERT INTO model_access (model, provider, category, display_name, min_plan, is_active)
VALUES
  ('veo3_lite', 'google', 'فيديو', 'Veo 3.1 Lite', 'free', true),
  ('gpt-image-2-text-to-image', 'openai', 'صور', 'GPT Image 2', 'free', true),
  ('gpt-image-2-image-to-image', 'openai', 'ريمكس', 'GPT Image 2 Edit', 'free', true)
ON CONFLICT (model) DO NOTHING;

UPDATE announcements SET is_active = false WHERE is_active = true;

INSERT INTO announcements (title, description, image_url, cta_text, cta_link, is_active, show_once, sort_order)
VALUES (
  'تم إضافة GPT Image 2 🎨',
  'أحدث جيل من OpenAI لتوليد وتعديل الصور بدقة فائقة، نصوص واضحة، وتفاصيل احترافية. جربه الآن!',
  'https://soweiomymeqfjpakohzc.supabase.co/storage/v1/object/public/cms-content/announcements/gpt-image-2.jpg',
  'جرب GPT Image 2',
  '/studio/image?model=gpt-image-2-text-to-image',
  true,
  false,
  0
);
