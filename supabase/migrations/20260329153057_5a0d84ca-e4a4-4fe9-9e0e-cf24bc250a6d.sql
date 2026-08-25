
-- Subscription requests table
CREATE TABLE public.subscription_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  status text NOT NULL DEFAULT 'pending',
  phone_number text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  activated_subscription_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;

-- Users can read their own requests
CREATE POLICY "Users read own subscription_requests"
ON public.subscription_requests FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own requests
CREATE POLICY "Users insert own subscription_requests"
ON public.subscription_requests FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Admins manage all
CREATE POLICY "Admins manage subscription_requests"
ON public.subscription_requests FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
