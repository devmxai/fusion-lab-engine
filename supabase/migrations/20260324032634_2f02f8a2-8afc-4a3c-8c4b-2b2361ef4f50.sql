
-- Allow users to update their own credits (for spending)
CREATE POLICY "Users update own credits"
ON public.user_credits
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow users to insert their own credit transactions
CREATE POLICY "Users insert own transactions"
ON public.credit_transactions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND action = 'spent');
