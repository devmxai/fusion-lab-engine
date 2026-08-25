UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'video/mp4','video/quicktime','video/webm','video/x-msvideo','video/x-matroska','video/3gpp','video/mpeg','video/ogg','video/avi',
  'image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic','image/heif',
  'audio/mpeg','audio/mp3','audio/mp4','audio/wav','audio/x-wav','audio/aac','audio/ogg','audio/webm','audio/flac',
  'application/octet-stream'
],
file_size_limit = 209715200
WHERE id = 'temp-uploads';