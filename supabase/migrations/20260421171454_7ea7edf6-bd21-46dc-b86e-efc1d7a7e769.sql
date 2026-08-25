-- Make temp-uploads bucket PUBLIC so external providers (like KIE.AI) can fetch assets via clean URLs ending with the correct file extension.
-- Security is preserved via unguessable random paths (UUID/user-id + timestamp + random).
-- Files are short-lived and only used for in-flight generation tasks.
UPDATE storage.buckets
SET public = true
WHERE id = 'temp-uploads';

-- Ensure broad media MIME types remain allowed (idempotent)
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/png','image/jpeg','image/jpg','image/webp','image/gif','image/heic',
  'video/mp4','video/quicktime','video/x-matroska','video/x-msvideo','video/webm','video/mpeg','video/3gpp',
  'audio/mpeg','audio/wav','audio/mp4','audio/aac','audio/ogg','audio/webm',
  'application/octet-stream'
],
file_size_limit = 209715200 -- 200MB
WHERE id = 'temp-uploads';

-- Allow public read for temp-uploads while keeping writes restricted to the file owner
DROP POLICY IF EXISTS "Public read temp-uploads" ON storage.objects;
CREATE POLICY "Public read temp-uploads"
ON storage.objects FOR SELECT
USING (bucket_id = 'temp-uploads');

-- Keep existing user-scoped insert/update/delete policies (do not modify)