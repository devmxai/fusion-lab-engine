-- Ensure pgcrypto is in extensions schema (Supabase default)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================
-- 1) ROLE MANAGEMENT HARDENING
-- ============================================================
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;

CREATE POLICY "Admins read all roles"
  ON public.user_roles
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- 2) PHONE OTP HARDENING (schema only — function uses extensions.digest)
-- ============================================================
ALTER TABLE public.phone_verifications
  ADD COLUMN IF NOT EXISTS otp_hash text,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

CREATE OR REPLACE FUNCTION public.hash_otp(p_otp text, p_user_id uuid, p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT encode(
    extensions.digest(
      (p_otp || ':' || p_user_id::text || ':' || p_phone || ':fusionlab_otp_pepper_v1')::bytea,
      'sha256'
    ),
    'hex'
  );
$$;

-- ============================================================
-- 3) STORAGE: generations bucket → PRIVATE
-- ============================================================
UPDATE storage.buckets SET public = false WHERE id = 'generations';

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (policyname ILIKE '%generations%' OR policyname ILIKE '%generation files%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Users read own generation files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'generations'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users upload own generation files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'generations'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users update own generation files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'generations'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own generation files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'generations'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Service role full access generations"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'generations')
  WITH CHECK (bucket_id = 'generations');

CREATE POLICY "Admins read all generation files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'generations'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- ============================================================
-- 4) STORAGE: temp-uploads bucket → PRIVATE
-- ============================================================
UPDATE storage.buckets SET public = false WHERE id = 'temp-uploads';

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname ILIKE '%temp%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Users read own temp uploads"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'temp-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users upload own temp uploads"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'temp-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own temp uploads"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'temp-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Service role full access temp uploads"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'temp-uploads')
  WITH CHECK (bucket_id = 'temp-uploads');
