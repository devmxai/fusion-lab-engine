
-- Create generation_jobs table for persistent job lifecycle tracking
CREATE TABLE public.generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id text,
  reservation_id uuid,
  tool_id text NOT NULL,
  tool_name text,
  model text NOT NULL,
  api_type text NOT NULL DEFAULT 'standard',
  prompt text,
  file_type text NOT NULL DEFAULT 'image',
  status text NOT NULL DEFAULT 'pending',
  progress integer NOT NULL DEFAULT 0,
  result_url text,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Index for user queries
CREATE INDEX idx_generation_jobs_user_status ON public.generation_jobs(user_id, status);
CREATE INDEX idx_generation_jobs_task_id ON public.generation_jobs(task_id);

-- RLS
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own jobs" ON public.generation_jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own jobs" ON public.generation_jobs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own jobs" ON public.generation_jobs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins manage all jobs" ON public.generation_jobs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.generation_jobs;
