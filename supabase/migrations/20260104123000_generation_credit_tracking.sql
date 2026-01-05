DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_reservation_status') THEN
    CREATE TYPE public.credit_reservation_status AS ENUM ('reserved', 'committed', 'released');
  END IF;
END $$;

ALTER TABLE public.user_credits
  ADD COLUMN IF NOT EXISTS reserved_monthly INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_bonus INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_transaction_type_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_transaction_type_check
  CHECK (
    transaction_type IN (
      'purchase',
      'subscription_grant',
      'usage',
      'bonus',
      'refund',
      'adjustment',
      'reservation',
      'release'
    )
  );

CREATE TABLE IF NOT EXISTS public.credit_reservations (
  request_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  monthly_amount INTEGER NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  bonus_amount INTEGER NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  status public.credit_reservation_status NOT NULL DEFAULT 'reserved',
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own credit reservations" ON public.credit_reservations;
CREATE POLICY "Users can view their own credit reservations" ON public.credit_reservations
  FOR SELECT USING (auth.uid() = user_id);

CREATE TRIGGER update_credit_reservations_updated_at
  BEFORE UPDATE ON public.credit_reservations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.image_generation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL CHECK (feature IN ('generate-scene-image', 'edit-scene-image', 'generate-character-reference')),
  story_id UUID,
  scene_id UUID,
  model TEXT,
  provider TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  credits_amount INTEGER NOT NULL DEFAULT 0,
  error_stage TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS image_generation_attempts_user_created_idx
  ON public.image_generation_attempts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS image_generation_attempts_feature_status_idx
  ON public.image_generation_attempts (feature, status);

ALTER TABLE public.image_generation_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own image generation attempts" ON public.image_generation_attempts;
CREATE POLICY "Users can view their own image generation attempts" ON public.image_generation_attempts
  FOR SELECT USING (auth.uid() = user_id);

CREATE TRIGGER update_image_generation_attempts_updated_at
  BEFORE UPDATE ON public.image_generation_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.credit_monitoring_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id UUID,
  feature TEXT,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_monitoring_events_created_idx
  ON public.credit_monitoring_events (created_at DESC);

ALTER TABLE public.credit_monitoring_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own credit monitoring events" ON public.credit_monitoring_events;
CREATE POLICY "Users can view their own credit monitoring events" ON public.credit_monitoring_events
  FOR SELECT USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.user_rate_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action, window_start)
);

ALTER TABLE public.user_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own rate limits" ON public.user_rate_limits;
CREATE POLICY "Users can view their own rate limits" ON public.user_rate_limits
  FOR SELECT USING (auth.uid() = user_id);

CREATE TRIGGER update_user_rate_limits_updated_at
  BEFORE UPDATE ON public.user_rate_limits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.reserve_credits(
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
  v_existing public.credit_reservations%ROWTYPE;
  v_monthly_available INTEGER;
  v_bonus_available INTEGER;
  v_monthly_reserve INTEGER;
  v_bonus_reserve INTEGER;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  PERFORM public.ensure_user_credits(p_user_id);
  PERFORM public.reset_user_credits_cycle(p_user_id);

  SELECT * INTO v_existing
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id;

  IF FOUND THEN
    IF v_existing.status = 'reserved' OR v_existing.status = 'committed' THEN
      SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
      v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
      v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);
      RETURN jsonb_build_object(
        'ok', true,
        'tier', v_row.tier,
        'remaining_monthly', v_monthly_after,
        'remaining_bonus', v_bonus_after,
        'reserved_monthly', v_existing.monthly_amount,
        'reserved_bonus', v_existing.bonus_amount,
        'status', v_existing.status,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  v_monthly_available := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_available := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  IF (v_monthly_available + v_bonus_available) < p_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_credits',
      'tier', v_row.tier,
      'remaining_monthly', v_monthly_available,
      'remaining_bonus', v_bonus_available
    );
  END IF;

  v_monthly_reserve := LEAST(p_amount, v_monthly_available);
  v_bonus_reserve := p_amount - v_monthly_reserve;

  UPDATE public.user_credits
  SET
    reserved_monthly = reserved_monthly + v_monthly_reserve,
    reserved_bonus = reserved_bonus + v_bonus_reserve
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_reservations (request_id, user_id, amount, monthly_amount, bonus_amount, status, description, metadata)
  VALUES (p_request_id, p_user_id, p_amount, v_monthly_reserve, v_bonus_reserve, 'reserved', p_description, p_metadata);

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
  VALUES (
    p_user_id,
    -p_amount,
    'reservation',
    p_description,
    p_metadata || jsonb_build_object('reserved_monthly', v_monthly_reserve, 'reserved_bonus', v_bonus_reserve),
    p_request_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'tier', v_row.tier,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after,
    'reserved_monthly', v_monthly_reserve,
    'reserved_bonus', v_bonus_reserve,
    'status', 'reserved'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_reserved_credits(
  p_user_id UUID,
  p_request_id UUID,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_credits%ROWTYPE;
  v_res public.credit_reservations%ROWTYPE;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  SELECT * INTO v_res
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_reservation');
  END IF;

  IF v_res.status = 'committed' THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
    v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);
    RETURN jsonb_build_object(
      'ok', true,
      'tier', v_row.tier,
      'remaining_monthly', v_monthly_after,
      'remaining_bonus', v_bonus_after,
      'idempotent', true
    );
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(reserved_monthly - v_res.monthly_amount, 0),
    reserved_bonus = GREATEST(reserved_bonus - v_res.bonus_amount, 0),
    monthly_credits_used = monthly_credits_used + v_res.monthly_amount,
    bonus_credits_used = bonus_credits_used + v_res.bonus_amount
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'committed', metadata = metadata || p_metadata
  WHERE request_id = p_request_id;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  IF v_res.monthly_amount > 0 THEN
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
      -v_res.monthly_amount,
      'usage',
      COALESCE(v_res.description, 'Credit usage'),
      v_res.metadata || p_metadata,
      'monthly',
      v_monthly_after,
      v_bonus_after,
      p_request_id
    );
  END IF;

  IF v_res.bonus_amount > 0 THEN
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
      -v_res.bonus_amount,
      'usage',
      COALESCE(v_res.description, 'Credit usage'),
      v_res.metadata || p_metadata,
      'bonus',
      v_monthly_after,
      v_bonus_after,
      p_request_id
    );
  END IF;

  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
  VALUES (
    p_user_id,
    v_res.amount,
    'release',
    COALESCE(v_res.description, 'Credit reservation released'),
    (v_res.metadata || p_metadata) || jsonb_build_object('release_type', 'commit'),
    p_request_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'tier', v_row.tier,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_reserved_credits(
  p_user_id UUID,
  p_request_id UUID,
  p_reason TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_credits%ROWTYPE;
  v_res public.credit_reservations%ROWTYPE;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  SELECT * INTO v_res
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_reservation');
  END IF;

  IF v_res.status = 'released' THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
    v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);
    RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(reserved_monthly - v_res.monthly_amount, 0),
    reserved_bonus = GREATEST(reserved_bonus - v_res.bonus_amount, 0)
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'released', metadata = metadata || p_metadata || jsonb_build_object('release_reason', p_reason)
  WHERE request_id = p_request_id;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
  VALUES (
    p_user_id,
    v_res.amount,
    'release',
    COALESCE(p_reason, 'Credit reservation released'),
    (v_res.metadata || p_metadata) || jsonb_build_object('release_type', 'rollback'),
    p_request_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id UUID,
  p_action TEXT,
  p_max INTEGER,
  p_window_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := now();
  v_window_start TIMESTAMP WITH TIME ZONE;
  v_count INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;
  IF p_action IS NULL OR length(trim(p_action)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_action');
  END IF;
  IF p_max IS NULL OR p_max <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_max');
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_window_seconds');
  END IF;

  v_window_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.user_rate_limits (user_id, action, window_start, count)
  VALUES (p_user_id, p_action, v_window_start, 1)
  ON CONFLICT (user_id, action, window_start)
  DO UPDATE SET count = public.user_rate_limits.count + 1
  WHERE public.user_rate_limits.count < p_max
  RETURNING count INTO v_count;

  IF v_count IS NULL THEN
    SELECT count INTO v_count
    FROM public.user_rate_limits
    WHERE user_id = p_user_id AND action = p_action AND window_start = v_window_start;

    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited', 'count', COALESCE(v_count, p_max), 'max', p_max, 'window_start', v_window_start);
  END IF;

  RETURN jsonb_build_object('ok', true, 'count', v_count, 'max', p_max, 'window_start', v_window_start);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_user_credits_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  v_balance := GREATEST(
    (NEW.monthly_credits_per_cycle - NEW.monthly_credits_used - NEW.reserved_monthly) +
    (NEW.bonus_credits_total - NEW.bonus_credits_used - NEW.reserved_bonus),
    0
  );

  UPDATE public.profiles
  SET
    credits_balance = v_balance,
    updated_at = now()
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_credits_to_profile_trigger ON public.user_credits;
CREATE TRIGGER sync_credits_to_profile_trigger
  AFTER INSERT OR UPDATE OF
    monthly_credits_per_cycle,
    monthly_credits_used,
    bonus_credits_total,
    bonus_credits_used,
    reserved_monthly,
    reserved_bonus
  ON public.user_credits
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_credits_to_profile();

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

  IF p_request_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.credit_transactions ct
    WHERE ct.user_id = p_user_id
      AND ct.request_id = p_request_id
      AND ct.transaction_type = 'usage'
  ) THEN
    v_monthly_remaining := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
    v_bonus_remaining := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);
    RETURN jsonb_build_object(
      'ok', true,
      'tier', v_row.tier,
      'remaining_monthly', v_monthly_remaining,
      'remaining_bonus', v_bonus_remaining,
      'cycle_end_at', v_row.cycle_end_at,
      'idempotent', true
    );
  END IF;

  v_monthly_remaining := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_remaining := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

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
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

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

CREATE OR REPLACE FUNCTION public.refund_consumed_credits(
  p_user_id UUID,
  p_request_id UUID,
  p_reason TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_credits%ROWTYPE;
  v_monthly_refund INTEGER := 0;
  v_bonus_refund INTEGER := 0;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.credit_transactions ct
    WHERE ct.user_id = p_user_id
      AND ct.request_id = p_request_id
      AND ct.transaction_type = 'refund'
      AND (ct.metadata ->> 'refund_of_request_id') = (p_request_id::text)
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_refunded', true);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN ct.pool = 'monthly' THEN -ct.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ct.pool = 'bonus' THEN -ct.amount ELSE 0 END), 0)
  INTO v_monthly_refund, v_bonus_refund
  FROM public.credit_transactions ct
  WHERE ct.user_id = p_user_id
    AND ct.request_id = p_request_id
    AND ct.transaction_type = 'usage';

  IF COALESCE(v_monthly_refund, 0) <= 0 AND COALESCE(v_bonus_refund, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_usage_to_refund');
  END IF;

  PERFORM public.ensure_user_credits(p_user_id);

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(monthly_credits_used - v_monthly_refund, 0),
    bonus_credits_used = GREATEST(bonus_credits_used - v_bonus_refund, 0)
  WHERE user_id = p_user_id;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  IF v_monthly_refund > 0 THEN
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
      v_monthly_refund,
      'refund',
      p_reason,
      p_metadata || jsonb_build_object('refund_of_request_id', p_request_id),
      'monthly',
      v_monthly_after,
      v_bonus_after,
      p_request_id
    );
  END IF;

  IF v_bonus_refund > 0 THEN
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
      v_bonus_refund,
      'refund',
      p_reason,
      p_metadata || jsonb_build_object('refund_of_request_id', p_request_id),
      'bonus',
      v_monthly_after,
      v_bonus_after,
      p_request_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_monthly', v_monthly_refund,
    'refunded_bonus', v_bonus_refund,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_credits(UUID, INTEGER, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_reserved_credits(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_rate_limit(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, TEXT, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_reserved_credits(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(UUID, TEXT, INTEGER, INTEGER) TO service_role;

