
-- Add provider billing tracking fields to generation_jobs
ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS provider_status_code text,
  ADD COLUMN IF NOT EXISTS provider_status_message text,
  ADD COLUMN IF NOT EXISTS provider_billing_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS provider_refund_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS reconciliation_notes text,
  ADD COLUMN IF NOT EXISTS upstream_task_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS upstream_terminal_at timestamptz;

-- Add comment for billing lifecycle documentation
COMMENT ON COLUMN public.generation_jobs.provider_billing_state IS 
  'Lifecycle: unknown → no_charge_confirmed | upstream_task_created | upstream_success_confirmed | upstream_failed_refunded_confirmed | upstream_failed_refund_unknown | user_refunded | manual_review_required';

COMMENT ON COLUMN public.generation_jobs.reconciliation_status IS
  'Values: not_required | pending_review | resolved | escalated';
