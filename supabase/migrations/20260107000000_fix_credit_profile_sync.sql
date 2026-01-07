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
    UPDATE public.profiles
    SET credits_balance = (v_monthly_after + v_bonus_after)
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after, 'idempotent', true);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;

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

  UPDATE public.credit_transactions
  SET 
    transaction_type = 'usage',
    description = COALESCE(v_res.description, 'Credit usage'),
    metadata = v_res.metadata || p_metadata,
    created_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'reservation';

  IF NOT FOUND THEN
     v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly - v_res.monthly_amount, 0); 
     v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus - v_res.bonus_amount, 0);

     INSERT INTO public.credit_transactions (
       user_id, amount, transaction_type, description, metadata, pool, request_id
     ) VALUES (
       p_user_id, -v_res.amount, 'usage', COALESCE(v_res.description, 'Credit usage'), v_res.metadata || p_metadata, 
       CASE WHEN v_res.monthly_amount > 0 THEN 'monthly' ELSE 'bonus' END, 
       p_request_id
     );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  UPDATE public.profiles
  SET credits_balance = (v_monthly_after + v_bonus_after)
  WHERE user_id = p_user_id;

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
  v_refund_res JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  SELECT * INTO v_res FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_reservation');
  END IF;

  IF v_res.status = 'released' THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
    v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);
    UPDATE public.profiles
    SET credits_balance = (v_monthly_after + v_bonus_after)
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
  END IF;

  IF v_res.status = 'committed' THEN
    v_refund_res := public.refund_consumed_credits(p_user_id, p_request_id, p_reason, p_metadata);
    UPDATE public.credit_reservations
    SET status = 'released', metadata = metadata || p_metadata || jsonb_build_object('release_reason', p_reason, 'converted_from', 'committed')
    WHERE request_id = p_request_id;
    RETURN v_refund_res;
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(reserved_monthly - v_res.monthly_amount, 0),
    reserved_bonus = GREATEST(reserved_bonus - v_res.bonus_amount, 0)
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'released', metadata = metadata || p_metadata || jsonb_build_object('release_reason', p_reason)
  WHERE request_id = p_request_id;

  UPDATE public.credit_transactions
  SET 
    transaction_type = 'release',
    amount = 0,
    description = COALESCE(p_reason, 'Credit reservation released'),
    metadata = (v_res.metadata || p_metadata) || jsonb_build_object('release_type', 'rollback'),
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'reservation';

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  UPDATE public.profiles
  SET credits_balance = (v_monthly_after + v_bonus_after)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
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
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

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
      AND (
        (ct.transaction_type = 'released')
        OR
        (ct.transaction_type = 'refund' AND (ct.metadata ->> 'refund_of_request_id') = (p_request_id::text))
      )
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

  IF v_row.tier = 'professional' THEN
      UPDATE public.credit_transactions
      SET 
        transaction_type = 'released',
        amount = 0,
        description = p_reason,
        metadata = metadata || p_metadata || jsonb_build_object('refund_reason', p_reason),
        updated_at = now()
      WHERE request_id = p_request_id AND transaction_type = 'usage';

      RETURN jsonb_build_object('ok', true, 'unlimited', true);
  END IF;

  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(monthly_credits_used - v_monthly_refund, 0),
    bonus_credits_used = GREATEST(bonus_credits_used - v_bonus_refund, 0)
  WHERE user_id = p_user_id;

  UPDATE public.credit_transactions
  SET 
    transaction_type = 'released',
    amount = 0,
    description = p_reason,
    metadata = metadata || p_metadata || jsonb_build_object('refund_reason', p_reason, 'original_cost', (v_monthly_refund + v_bonus_refund)),
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'usage';

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);

  UPDATE public.profiles
  SET credits_balance = (v_monthly_after + v_bonus_after)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_monthly', v_monthly_refund,
    'refunded_bonus', v_bonus_refund,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.force_refund_request(
  p_request_id UUID,
  p_reason TEXT DEFAULT 'Force refund'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage_monthly INTEGER;
  v_usage_bonus INTEGER;
  v_user_id UUID;
  v_row public.user_credits%ROWTYPE;
BEGIN
  SELECT user_id, 
         COALESCE(SUM(CASE WHEN pool = 'monthly' THEN -amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN pool = 'bonus' THEN -amount ELSE 0 END), 0)
  INTO v_user_id, v_usage_monthly, v_usage_bonus
  FROM public.credit_transactions
  WHERE request_id = p_request_id AND transaction_type = 'usage'
  GROUP BY user_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_usage_found');
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(monthly_credits_used - v_usage_monthly, 0),
    bonus_credits_used = GREATEST(bonus_credits_used - v_usage_bonus, 0)
  WHERE user_id = v_user_id;

  UPDATE public.credit_transactions
  SET 
    transaction_type = 'released',
    amount = 0,
    description = p_reason,
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'usage';
  
  UPDATE public.credit_reservations
  SET status = 'released'
  WHERE request_id = p_request_id;
  
  SELECT * INTO v_row FROM public.user_credits WHERE user_id = v_user_id;
  UPDATE public.profiles
  SET credits_balance = GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0) + 
                       GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0)
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'refunded', v_usage_monthly + v_usage_bonus);
END;
$$;

