-- Re-enable public READ on generations bucket (legacy URLs are stored public)
-- BUT keep write/update/delete strictly user-scoped.
UPDATE storage.buckets SET public = true WHERE id = 'generations';

-- Re-add public SELECT (only knowing the exact path works; listing is implicitly blocked)
CREATE POLICY "Public read generation files"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'generations');

-- Drop the now-redundant authenticated-only SELECT policies for generations
DROP POLICY IF EXISTS "Users read own generation files" ON storage.objects;
DROP POLICY IF EXISTS "Admins read all generation files" ON storage.objects;
