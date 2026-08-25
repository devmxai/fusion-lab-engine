
-- homepage_banners table
CREATE TABLE public.homepage_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  title text,
  subtitle text,
  cta_text text,
  cta_link text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.homepage_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage banners" ON public.homepage_banners FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone reads banners" ON public.homepage_banners FOR SELECT TO anon, authenticated
  USING (true);

-- model_cards table
CREATE TABLE public.model_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id text NOT NULL UNIQUE,
  title text,
  description text,
  image_url text,
  category text,
  sort_order integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.model_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage model_cards" ON public.model_cards FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone reads model_cards" ON public.model_cards FOR SELECT TO anon, authenticated
  USING (true);

-- Add prompt and is_published to trending tables
ALTER TABLE public.trending_images ADD COLUMN IF NOT EXISTS prompt text;
ALTER TABLE public.trending_images ADD COLUMN IF NOT EXISTS is_published boolean DEFAULT true;

ALTER TABLE public.trending_videos ADD COLUMN IF NOT EXISTS prompt text;
ALTER TABLE public.trending_videos ADD COLUMN IF NOT EXISTS is_published boolean DEFAULT true;

-- Storage bucket for CMS content
INSERT INTO storage.buckets (id, name, public) VALUES ('cms-content', 'cms-content', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for cms-content
CREATE POLICY "Admins upload cms content" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cms-content' AND (SELECT has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins update cms content" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cms-content' AND (SELECT has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins delete cms content" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cms-content' AND (SELECT has_role(auth.uid(), 'admin')));
CREATE POLICY "Anyone reads cms content" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'cms-content');
