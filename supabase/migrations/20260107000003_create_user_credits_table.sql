-- Create user_credits table for advanced credit management
CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_credits_per_cycle INTEGER NOT NULL DEFAULT 10,
  monthly_credits_used INTEGER NOT NULL DEFAULT 0,
  bonus_credits_total INTEGER NOT NULL DEFAULT 5,
  bonus_credits_used INTEGER NOT NULL DEFAULT 0,
  reserved_monthly INTEGER NOT NULL DEFAULT 0,
  reserved_bonus INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create credit_reservations table for credit reservation system
CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  monthly_credits_used INTEGER NOT NULL DEFAULT 0,
  bonus_credits_used INTEGER NOT NULL DEFAULT 0,
  feature TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS for user_credits
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own credits" ON public.user_credits;
CREATE POLICY "Users can view their own credits" ON public.user_credits
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "System can manage user credits" ON public.user_credits;
CREATE POLICY "System can manage user credits" ON public.user_credits
  FOR ALL USING (true);

-- RLS for credit_reservations
ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own reservations" ON public.credit_reservations;
CREATE POLICY "Users can view their own reservations" ON public.credit_reservations
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "System can manage reservations" ON public.credit_reservations;
CREATE POLICY "System can manage reservations" ON public.credit_reservations
  FOR ALL USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON public.user_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_id ON public.credit_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_request_id ON public.credit_reservations(request_id);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_status ON public.credit_reservations(status);

-- Grant permissions
GRANT SELECT ON public.user_credits TO authenticated;
GRANT SELECT ON public.credit_reservations TO authenticated;
GRANT ALL ON public.user_credits TO service_role;
GRANT ALL ON public.credit_reservations TO service_role;
