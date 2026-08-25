
-- Add seen_at column for tracking unseen completed/failed jobs
ALTER TABLE public.generation_jobs ADD COLUMN IF NOT EXISTS seen_at timestamptz DEFAULT NULL;
