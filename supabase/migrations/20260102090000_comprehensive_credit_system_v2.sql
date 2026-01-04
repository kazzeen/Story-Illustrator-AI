-- Comprehensive credit system (v2)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_tier') THEN
    CREATE TYPE public.credit_tier AS ENUM ('basic', 'starter', 'creator', 'professional');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_pool') THEN
    CREATE TYPE public.credit_pool AS ENUM ('monthly', 'bonus');
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier public.credit_tier NOT NULL DEFAULT 'basic',
  monthly_credits_per_cycle INTEGER NOT NULL DEFAULT 5,
  monthly_credits_used INTEGER NOT NULL DEFAULT 0,
  bonus_credits_total INTEGER NOT NULL DEFAULT 0,
  bonus_credits_used INTEGER NOT NULL DEFAULT 0,
  cycle_start_at TIMESTAMP WITH TIME ZONE NOT NULL,
  cycle_end_at TIMESTAMP WITH TIME ZONE NOT NULL,
  cycle_source TEXT NOT NULL DEFAULT 'profile_created' CHECK (cycle_source IN ('profile_created', 'stripe_subscription')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  bonus_granted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own credits" ON public.user_credits;
CREATE POLICY "Users can view their own credits" ON public.user_credits
  FOR SELECT USING (auth.uid() = user_id);

CREATE TRIGGER update_user_credits_updated_at
  BEFORE UPDATE ON public.user_credits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS pool public.credit_pool,
  ADD COLUMN IF NOT EXISTS balance_monthly_after INTEGER,
  ADD COLUMN IF NOT EXISTS balance_bonus_after INTEGER,
  ADD COLUMN IF NOT EXISTS stripe_event_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS created_by UUID;

CREATE OR REPLACE FUNCTION public._credits_per_cycle_for_tier(p_tier public.credit_tier)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_tier
    WHEN 'basic' THEN 5
    WHEN 'starter' THEN 50
    WHEN 'creator' THEN 200
    WHEN 'professional' THEN 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._compute_basic_cycle_window(p_anchor TIMESTAMP WITH TIME ZONE, p_now TIMESTAMP WITH TIME ZONE)
RETURNS TABLE (cycle_start TIMESTAMP WITH TIME ZONE, cycle_end TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_start TIMESTAMP WITH TIME ZONE := p_anchor;
  v_end TIMESTAMP WITH TIME ZONE := p_anchor + INTERVAL '1 month';
BEGIN
  IF p_now < v_start THEN
    RETURN QUERY SELECT v_start, v_end;
    RETURN;
  END IF;

  WHILE v_end <= p_now LOOP
    v_start := v_end;
    v_end := v_end + INTERVAL '1 month';
  END LOOP;

  RETURN QUERY SELECT v_start, v_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_user_credits(p_user_id UUID)
RETURNS public.user_credits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.user_credits%ROWTYPE;
  v_profile_created TIMESTAMP WITH TIME ZONE;
  v_window RECORD;
  v_per_cycle INTEGER;
  v_inserted_user_id UUID;
BEGIN
  SELECT * INTO v_existing FROM public.user_credits WHERE user_id = p_user_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  SELECT created_at INTO v_profile_created FROM public.profiles WHERE user_id = p_user_id;
  IF v_profile_created IS NULL THEN
    v_profile_created := now();
  END IF;

  SELECT cycle_start, cycle_end INTO v_window
  FROM public._compute_basic_cycle_window(v_profile_created, now());

  v_per_cycle := public._credits_per_cycle_for_tier('basic');

  INSERT INTO public.user_credits (
    user_id,
    tier,
    monthly_credits_per_cycle,
    monthly_credits_used,
    bonus_credits_total,
    bonus_credits_used,
    cycle_start_at,
    cycle_end_at,
    cycle_source
  ) VALUES (
    p_user_id,
    'basic',
    v_per_cycle,
    0,
    0,
    0,
    v_window.cycle_start,
    v_window.cycle_end,
    'profile_created'
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO v_inserted_user_id;

  IF v_inserted_user_id IS NOT NULL THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, pool)
    VALUES (
      p_user_id,
      v_per_cycle,
      'subscription_grant',
      'Monthly credit allocation (basic)',
      jsonb_build_object('tier', 'basic', 'source', 'initial', 'cycle_start', v_window.cycle_start, 'cycle_end', v_window.cycle_end),
      'monthly'
    );
  END IF;

  SELECT * INTO v_existing FROM public.user_credits WHERE user_id = p_user_id;
  RETURN v_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_user_credits_cycle(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := now();
  v_row public.user_credits%ROWTYPE;
  v_start TIMESTAMP WITH TIME ZONE;
  v_end TIMESTAMP WITH TIME ZONE;
  v_anchor TIMESTAMP WITH TIME ZONE;
  v_window RECORD;
  v_per_cycle INTEGER;
  v_did_reset BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.ensure_user_credits(p_user_id);
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  IF v_row.tier = 'professional' THEN
    RETURN;
  END IF;

  IF v_row.cycle_source = 'profile_created' THEN
    SELECT created_at INTO v_anchor FROM public.profiles WHERE user_id = p_user_id;
    IF v_anchor IS NULL THEN
      v_anchor := v_row.cycle_start_at;
    END IF;
    SELECT cycle_start, cycle_end INTO v_window
    FROM public._compute_basic_cycle_window(v_anchor, v_now);

    v_start := v_window.cycle_start;
    v_end := v_window.cycle_end;
  ELSE
    v_start := v_row.cycle_start_at;
    v_end := v_row.cycle_end_at;
    WHILE v_end <= v_now LOOP
      v_start := v_end;
      v_end := v_end + INTERVAL '1 month';
      v_did_reset := TRUE;
    END LOOP;
  END IF;

  IF v_row.cycle_end_at <= v_now OR v_row.cycle_start_at <> v_start OR v_row.cycle_end_at <> v_end THEN
    v_did_reset := TRUE;
  END IF;

  IF NOT v_did_reset THEN
    RETURN;
  END IF;

  v_per_cycle := public._credits_per_cycle_for_tier(v_row.tier);

  UPDATE public.user_credits
  SET
    cycle_start_at = v_start,
    cycle_end_at = v_end,
    monthly_credits_per_cycle = v_per_cycle,
    monthly_credits_used = 0
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, pool)
  VALUES (
    p_user_id,
    v_per_cycle,
    'subscription_grant',
    'Monthly credit allocation',
    jsonb_build_object('tier', v_row.tier, 'source', 'cycle_reset', 'cycle_start', v_start, 'cycle_end', v_end),
    'monthly'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_description TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_credits%ROWTYPE;
  v_monthly_remaining INTEGER;
  v_bonus_remaining INTEGER;
  v_monthly_spend INTEGER;
  v_bonus_spend INTEGER;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  PERFORM public.ensure_user_credits(p_user_id);
  PERFORM public.reset_user_credits_cycle(p_user_id);

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  IF v_row.tier = 'professional' THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      -p_amount,
      'usage',
      p_description,
      p_metadata || jsonb_build_object('tier', 'professional', 'unlimited', true),
      p_request_id
    );
    RETURN jsonb_build_object('ok', true, 'tier', 'professional', 'unlimited', true);
  END IF;

  v_monthly_remaining := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);
  v_bonus_remaining := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);

  IF (v_monthly_remaining + v_bonus_remaining) < p_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_credits',
      'remaining_monthly', v_monthly_remaining,
      'remaining_bonus', v_bonus_remaining,
      'tier', v_row.tier
    );
  END IF;

  v_monthly_spend := LEAST(p_amount, v_monthly_remaining);
  v_bonus_spend := p_amount - v_monthly_spend;

  UPDATE public.user_credits
  SET
    monthly_credits_used = monthly_credits_used + v_monthly_spend,
    bonus_credits_used = bonus_credits_used + v_bonus_spend
  WHERE user_id = p_user_id;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);

  IF v_monthly_spend > 0 THEN
    INSERT INTO public.credit_transactions (
      user_id,
      amount,
      transaction_type,
      description,
      metadata,
      pool,
      balance_monthly_after,
      balance_bonus_after,
      request_id
    ) VALUES (
      p_user_id,
      -v_monthly_spend,
      'usage',
      p_description,
      p_metadata,
      'monthly',
      v_monthly_after,
      v_bonus_after,
      p_request_id
    );
  END IF;

  IF v_bonus_spend > 0 THEN
    INSERT INTO public.credit_transactions (
      user_id,
      amount,
      transaction_type,
      description,
      metadata,
      pool,
      balance_monthly_after,
      balance_bonus_after,
      request_id
    ) VALUES (
      p_user_id,
      -v_bonus_spend,
      'usage',
      p_description,
      p_metadata,
      'bonus',
      v_monthly_after,
      v_bonus_after,
      p_request_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tier', v_row.tier,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after,
    'cycle_end_at', v_row.cycle_end_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_bonus_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_reason TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_credits%ROWTYPE;
  v_bonus_after INTEGER;
  v_monthly_after INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  PERFORM public.ensure_user_credits(p_user_id);
  PERFORM public.reset_user_credits_cycle(p_user_id);

  UPDATE public.user_credits
  SET bonus_credits_total = GREATEST(bonus_credits_total + p_amount, 0)
  WHERE user_id = p_user_id;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);

  INSERT INTO public.credit_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    metadata,
    pool,
    balance_monthly_after,
    balance_bonus_after,
    created_by
  ) VALUES (
    p_user_id,
    p_amount,
    'adjustment',
    p_reason,
    p_metadata,
    'bonus',
    v_monthly_after,
    v_bonus_after,
    p_created_by
  );

  RETURN jsonb_build_object('ok', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_state(
  p_user_id UUID,
  p_tier public.credit_tier,
  p_customer_id TEXT,
  p_subscription_id TEXT,
  p_price_id TEXT,
  p_cycle_start TIMESTAMP WITH TIME ZONE,
  p_cycle_end TIMESTAMP WITH TIME ZONE,
  p_event_id TEXT,
  p_invoice_id TEXT DEFAULT NULL,
  p_reset_usage BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_per_cycle INTEGER;
  v_row public.user_credits%ROWTYPE;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
  v_bonus_amount INTEGER := 0;
BEGIN
  v_per_cycle := public._credits_per_cycle_for_tier(p_tier);

  PERFORM public.ensure_user_credits(p_user_id);

  UPDATE public.user_credits
  SET
    tier = p_tier,
    monthly_credits_per_cycle = v_per_cycle,
    cycle_start_at = p_cycle_start,
    cycle_end_at = p_cycle_end,
    cycle_source = 'stripe_subscription',
    stripe_customer_id = p_customer_id,
    stripe_subscription_id = p_subscription_id,
    stripe_price_id = p_price_id,
    monthly_credits_used = CASE WHEN p_reset_usage THEN 0 ELSE monthly_credits_used END
  WHERE user_id = p_user_id;

  IF p_reset_usage THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, pool, stripe_event_id, stripe_invoice_id, stripe_subscription_id)
    VALUES (
      p_user_id,
      v_per_cycle,
      'subscription_grant',
      'Monthly credit allocation (Stripe)',
      jsonb_build_object('tier', p_tier, 'source', 'stripe', 'cycle_start', p_cycle_start, 'cycle_end', p_cycle_end, 'price_id', p_price_id),
      'monthly',
      p_event_id,
      p_invoice_id,
      p_subscription_id
    );
  ELSE
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, stripe_event_id, stripe_invoice_id, stripe_subscription_id)
    VALUES (
      p_user_id,
      0,
      'purchase',
      'Subscription state updated (Stripe)',
      jsonb_build_object('tier', p_tier, 'price_id', p_price_id),
      p_event_id,
      p_invoice_id,
      p_subscription_id
    );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;

  IF (v_row.bonus_granted = FALSE) AND (p_reset_usage = TRUE) THEN
    IF p_tier = 'starter' THEN
      v_bonus_amount := 20;
    ELSIF p_tier = 'creator' THEN
      v_bonus_amount := 100;
    END IF;

    IF v_bonus_amount > 0 THEN
      UPDATE public.user_credits
      SET
        bonus_credits_total = bonus_credits_total + v_bonus_amount,
        bonus_granted = TRUE
      WHERE user_id = p_user_id;

      INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, pool, stripe_event_id, stripe_invoice_id, stripe_subscription_id)
      VALUES (
        p_user_id,
        v_bonus_amount,
        'bonus',
        'One-time bonus credits (first subscription)',
        jsonb_build_object('tier', p_tier, 'source', 'stripe', 'price_id', p_price_id),
        'bonus',
        p_event_id,
        p_invoice_id,
        p_subscription_id
      );
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);

  RETURN jsonb_build_object('ok', true, 'tier', v_row.tier, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_canceled(
  p_user_id UUID,
  p_event_id TEXT,
  p_subscription_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_created TIMESTAMP WITH TIME ZONE;
  v_window RECORD;
  v_per_cycle INTEGER;
  v_row public.user_credits%ROWTYPE;
BEGIN
  SELECT created_at INTO v_profile_created FROM public.profiles WHERE user_id = p_user_id;
  IF v_profile_created IS NULL THEN
    v_profile_created := now();
  END IF;

  SELECT cycle_start, cycle_end INTO v_window
  FROM public._compute_basic_cycle_window(v_profile_created, now());

  v_per_cycle := public._credits_per_cycle_for_tier('basic');

  PERFORM public.ensure_user_credits(p_user_id);

  UPDATE public.user_credits
  SET
    tier = 'basic',
    monthly_credits_per_cycle = v_per_cycle,
    monthly_credits_used = 0,
    cycle_start_at = v_window.cycle_start,
    cycle_end_at = v_window.cycle_end,
    cycle_source = 'profile_created',
    stripe_subscription_id = NULL,
    stripe_price_id = NULL
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, pool, stripe_event_id, stripe_subscription_id)
  VALUES (
    p_user_id,
    v_per_cycle,
    'subscription_grant',
    'Monthly credit allocation (basic after cancellation)',
    jsonb_build_object('tier', 'basic', 'source', 'stripe_cancel', 'cycle_start', v_window.cycle_start, 'cycle_end', v_window.cycle_end),
    'monthly',
    p_event_id,
    p_subscription_id
  );

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  RETURN jsonb_build_object(
    'ok', true,
    'tier', v_row.tier,
    'remaining_monthly', GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0),
    'remaining_bonus', GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name');
  PERFORM public.ensure_user_credits(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_credits(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_user_credits_cycle(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_credits(UUID, INTEGER, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_bonus_credits(UUID, INTEGER, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_stripe_subscription_state(UUID, public.credit_tier, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_stripe_subscription_canceled(UUID, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_user_credits(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_user_credits_cycle(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credits(UUID, INTEGER, TEXT, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_bonus_credits(UUID, INTEGER, TEXT, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_stripe_subscription_state(UUID, public.credit_tier, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_stripe_subscription_canceled(UUID, TEXT, TEXT) TO service_role;
