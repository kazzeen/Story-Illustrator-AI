-- Add credits and subscription fields to profiles
ALTER TABLE public.profiles 
ADD COLUMN credits_balance INTEGER NOT NULL DEFAULT 5, -- Start with 5 free credits
ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'starter', 'creator', 'professional')),
ADD COLUMN subscription_status TEXT DEFAULT 'active',
ADD COLUMN next_billing_date TIMESTAMP WITH TIME ZONE;

-- Create credit transactions table
CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- Positive for add, negative for spend
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'subscription_grant', 'usage', 'bonus', 'refund', 'adjustment')),
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS for transactions
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own transactions" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Only system (service role) can insert transactions for now, or use a secure function
-- allowing insert if user is purchasing (but that usually goes through a webhook)

-- Function to safely deduct credits
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_description TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance INTEGER;
  v_tier TEXT;
BEGIN
  -- Get current profile info
  SELECT credits_balance, subscription_tier INTO v_current_balance, v_tier
  FROM public.profiles
  WHERE user_id = p_user_id;

  -- Professional tier has unlimited credits (logic handled here or in caller, 
  -- but let's assume we still track usage for stats, but don't block if 0?)
  -- Actually, let's strictly deduct for now unless we handle "unlimited" by not calling this,
  -- OR we treat "unlimited" as just not failing.
  
  -- If unlimited, we might still want to log usage but not change balance?
  -- For now, let's implement standard deduction logic.
  
  IF v_current_balance < p_amount AND v_tier != 'professional' THEN
    RETURN FALSE;
  END IF;

  -- Deduct credits
  UPDATE public.profiles
  SET credits_balance = credits_balance - p_amount,
      updated_at = now()
  WHERE user_id = p_user_id;

  -- Log transaction
  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata)
  VALUES (p_user_id, -p_amount, 'usage', p_description, p_metadata);

  RETURN TRUE;
END;
$$;
