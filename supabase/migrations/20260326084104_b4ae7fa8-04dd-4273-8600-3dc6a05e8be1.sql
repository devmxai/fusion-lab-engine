
-- Add phone fields to profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS phone_verified boolean DEFAULT false;

-- Create phone_verifications table for OTP storage
CREATE TABLE public.phone_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phone_number text NOT NULL,
  otp_code text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  verified boolean DEFAULT false,
  attempts integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own verifications" ON public.phone_verifications
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins manage all verifications" ON public.phone_verifications
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
