UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','video/mp4','audio/wav']
WHERE id = 'generated-originals-private';
