
-- Generations table to store all generated content
CREATE TABLE public.generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tool_id text NOT NULL,
  tool_name text,
  prompt text,
  file_url text NOT NULL,
  file_type text NOT NULL DEFAULT 'image',
  thumbnail_url text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own generations" ON public.generations
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own generations" ON public.generations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own generations" ON public.generations
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins manage all generations" ON public.generations
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Storage bucket for generated files
INSERT INTO storage.buckets (id, name, public) VALUES ('generations', 'generations', true);

-- Storage policies
CREATE POLICY "Users upload own generations" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'generations' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Public read generations" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'generations');

CREATE POLICY "Users delete own generation files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'generations' AND (storage.foldername(name))[1] = auth.uid()::text);
