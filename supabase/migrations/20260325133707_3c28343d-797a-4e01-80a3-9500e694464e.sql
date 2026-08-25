-- Drop the old policy that only allows authenticated users
DROP POLICY IF EXISTS "Anyone can read pricing rules" ON public.pricing_rules;

-- Recreate it for both anon and authenticated roles
CREATE POLICY "Anyone can read pricing rules"
ON public.pricing_rules
FOR SELECT
TO anon, authenticated
USING (true);