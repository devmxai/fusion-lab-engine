
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  image_url text,
  cta_text text DEFAULT 'جرب الآن',
  cta_link text DEFAULT '/studio/seedance',
  is_active boolean DEFAULT true,
  show_once boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone reads active announcements"
  ON public.announcements FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "Admins manage announcements"
  ON public.announcements FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
