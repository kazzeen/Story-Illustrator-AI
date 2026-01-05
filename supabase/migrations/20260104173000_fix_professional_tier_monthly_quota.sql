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

  IF p_request_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.credit_transactions ct
    WHERE ct.user_id = p_user_id
      AND ct.request_id = p_request_id
      AND ct.transaction_type = 'usage'
  ) THEN
    v_monthly_remaining := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);
    v_bonus_remaining := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);
    RETURN jsonb_build_object(
      'ok', true,
      'tier', v_row.tier,
      'remaining_monthly', v_monthly_remaining,
      'remaining_bonus', v_bonus_remaining,
      'cycle_end_at', v_row.cycle_end_at,
      'idempotent', true
    );
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
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);

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

WITH net_usage AS (
  SELECT
    uc.user_id,
    COALESCE(
      SUM(
        CASE
          WHEN ct.transaction_type = 'usage' THEN -ct.amount
          WHEN ct.transaction_type = 'refund' THEN -ct.amount
          ELSE 0
        END
      ),
      0
    ) AS net_used
  FROM public.user_credits uc
  LEFT JOIN public.credit_transactions ct
    ON ct.user_id = uc.user_id
   AND ct.created_at >= uc.cycle_start_at
   AND ct.created_at < uc.cycle_end_at
   AND ct.transaction_type IN ('usage', 'refund')
  WHERE uc.tier = 'professional'
  GROUP BY uc.user_id
)
UPDATE public.user_credits uc
SET monthly_credits_used = GREATEST(net_usage.net_used, 0)
FROM net_usage
WHERE uc.user_id = net_usage.user_id;

REVOKE ALL ON FUNCTION public.reset_user_credits_cycle(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_user_credits_cycle(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.consume_credits(UUID, INTEGER, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_credits(UUID, INTEGER, TEXT, JSONB, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO service_role;
