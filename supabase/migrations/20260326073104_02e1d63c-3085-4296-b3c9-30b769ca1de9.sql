
-- Add reservation_id column to generations for idempotency linkage
ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS reservation_id uuid;

-- Create unique index to prevent duplicate generation records per reservation
CREATE UNIQUE INDEX IF NOT EXISTS idx_generations_reservation_id_unique 
  ON public.generations (reservation_id) 
  WHERE reservation_id IS NOT NULL;
