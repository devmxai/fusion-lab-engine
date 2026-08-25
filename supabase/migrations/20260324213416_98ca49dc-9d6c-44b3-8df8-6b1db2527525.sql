
CREATE TABLE public.trending_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  image_url TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE public.trending_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.trending_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trending_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view trending images" ON public.trending_images FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can view trending videos" ON public.trending_videos FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Admins can manage trending images" ON public.trending_images FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage trending videos" ON public.trending_videos FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
