ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS details JSONB;

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_unique_checkout_session_purchase
  ON public.credit_transactions (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL AND transaction_type = 'purchase';

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_unique_payment_intent_purchase
  ON public.credit_transactions (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL AND transaction_type = 'purchase';

CREATE OR REPLACE FUNCTION public.sync_user_credits_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INTEGER;
  v_subscription_tier TEXT;
BEGIN
  v_balance := GREATEST(
    (NEW.monthly_credits_per_cycle - NEW.monthly_credits_used) +
    (NEW.bonus_credits_total - NEW.bonus_credits_used),
    0
  );

  v_subscription_tier := CASE
    WHEN NEW.tier = 'basic' THEN 'free'
    ELSE NEW.tier::text
  END;

  UPDATE public.profiles
  SET
    credits_balance = v_balance,
    subscription_tier = v_subscription_tier,
    next_billing_date = NEW.cycle_end_at,
    updated_at = now()
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_credits_to_profile_trigger ON public.user_credits;
CREATE TRIGGER sync_credits_to_profile_trigger
  AFTER INSERT OR UPDATE OF
    tier,
    cycle_end_at,
    monthly_credits_per_cycle,
    monthly_credits_used,
    bonus_credits_total,
    bonus_credits_used
  ON public.user_credits
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_credits_to_profile();

CREATE OR REPLACE FUNCTION public.admin_apply_stripe_credit_pack_purchase(
  p_user_id UUID,
  p_amount INTEGER,
  p_event_id TEXT,
  p_checkout_session_id TEXT,
  p_payment_intent_id TEXT DEFAULT NULL,
  p_customer_id TEXT DEFAULT NULL,
  p_price_id TEXT DEFAULT NULL,
  p_pack TEXT DEFAULT NULL
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
  v_exists BOOLEAN := FALSE;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  IF p_checkout_session_id IS NULL OR length(trim(p_checkout_session_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_checkout_session_id');
  END IF;

  PERFORM public.ensure_user_credits(p_user_id);
  PERFORM public.reset_user_credits_cycle(p_user_id);

  SELECT EXISTS(
    SELECT 1
    FROM public.credit_transactions
    WHERE user_id = p_user_id
      AND transaction_type = 'purchase'
      AND (
        (stripe_checkout_session_id IS NOT NULL AND stripe_checkout_session_id = p_checkout_session_id) OR
        (p_payment_intent_id IS NOT NULL AND stripe_payment_intent_id = p_payment_intent_id)
      )
  )
  INTO v_exists;

  IF v_exists THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);
    v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);
    RETURN jsonb_build_object(
      'ok', true,
      'already_applied', true,
      'remaining_monthly', v_monthly_after,
      'remaining_bonus', v_bonus_after
    );
  END IF;

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
    stripe_event_id,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    created_by
  ) VALUES (
    p_user_id,
    p_amount,
    'purchase',
    'Stripe credit pack purchase',
    jsonb_build_object(
      'source', 'stripe',
      'pack', p_pack,
      'price_id', p_price_id,
      'customer_id', p_customer_id
    ),
    'bonus',
    v_monthly_after,
    v_bonus_after,
    p_event_id,
    p_checkout_session_id,
    p_payment_intent_id,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_stripe_credit_pack_purchase(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_apply_stripe_credit_pack_purchase(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE INDEX IF NOT EXISTS stripe_webhook_events_status_processed_at_idx
  ON public.stripe_webhook_events (status, processed_at DESC);

CREATE OR REPLACE FUNCTION public.admin_credit_system_metrics(p_window_minutes INTEGER DEFAULT 60)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window INTERVAL;
  v_failures INTEGER;
  v_recent_errors JSONB;
  v_tier_mismatch INTEGER;
  v_balance_mismatch INTEGER;
BEGIN
  v_window := make_interval(mins => GREATEST(COALESCE(p_window_minutes, 60), 1));

  SELECT COUNT(*) INTO v_failures
  FROM public.stripe_webhook_events
  WHERE status = 'error'
    AND processed_at IS NOT NULL
    AND processed_at >= now() - v_window;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'event_id', e.event_id,
    'event_type', e.event_type,
    'user_id', e.user_id,
    'reason', e.reason,
    'processed_at', e.processed_at
  ) ORDER BY e.processed_at DESC), '[]'::jsonb)
  INTO v_recent_errors
  FROM (
    SELECT event_id, event_type, user_id, reason, processed_at
    FROM public.stripe_webhook_events
    WHERE status = 'error'
      AND processed_at IS NOT NULL
      AND processed_at >= now() - v_window
    ORDER BY processed_at DESC
    LIMIT 25
  ) e;

  SELECT COUNT(*) INTO v_tier_mismatch
  FROM public.user_credits uc
  JOIN public.profiles p ON p.user_id = uc.user_id
  WHERE p.subscription_tier IS NOT NULL
    AND p.subscription_tier <> (CASE WHEN uc.tier = 'basic' THEN 'free' ELSE uc.tier::text END);

  SELECT COUNT(*) INTO v_balance_mismatch
  FROM public.user_credits uc
  JOIN public.profiles p ON p.user_id = uc.user_id
  WHERE p.credits_balance IS NOT NULL
    AND p.credits_balance <> GREATEST(
      (uc.monthly_credits_per_cycle - uc.monthly_credits_used) +
      (uc.bonus_credits_total - uc.bonus_credits_used),
      0
    );

  RETURN jsonb_build_object(
    'ok', true,
    'window_minutes', GREATEST(COALESCE(p_window_minutes, 60), 1),
    'stripe_webhook_error_count', v_failures,
    'stripe_webhook_recent_errors', v_recent_errors,
    'profile_tier_mismatch_count', v_tier_mismatch,
    'profile_balance_mismatch_count', v_balance_mismatch
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_credit_system_metrics(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_credit_system_metrics(INTEGER) TO service_role;
