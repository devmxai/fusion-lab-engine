
-- Create model_card_tabs table for dynamic tab management
CREATE TABLE public.model_card_tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  icon text DEFAULT 'layers',
  sort_order integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.model_card_tabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tabs" ON public.model_card_tabs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone reads tabs" ON public.model_card_tabs FOR SELECT TO anon, authenticated
  USING (true);

-- Insert default system tabs
INSERT INTO public.model_card_tabs (slug, label, sort_order, is_system) VALUES
  ('latest', 'الأحدث', 0, true),
  ('images', 'الصور', 1, true),
  ('videos', 'الفيديو', 2, true),
  ('remix', 'ريمكس', 3, true),
  ('avatar', 'افتار', 4, true),
  ('remove-bg', 'حذف الخلفية', 5, true),
  ('upscale', 'رفع الجودة', 6, true);

-- Add media_type column to model_cards
ALTER TABLE public.model_cards ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'image';
