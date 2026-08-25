-- Create temp-uploads bucket for large media files (video references for transfer models)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('temp-uploads', 'temp-uploads', true, 104857600, ARRAY['video/mp4','video/quicktime','video/webm','video/x-msvideo','video/x-matroska','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to temp-uploads
CREATE POLICY "Authenticated users can upload to temp-uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'temp-uploads');

-- Allow authenticated users to read their own uploads
CREATE POLICY "Users can read temp-uploads"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'temp-uploads');

-- Allow public access for reading (so KIE.AI can access the URLs)
CREATE POLICY "Public read access for temp-uploads"
ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'temp-uploads');