CREATE OR REPLACE FUNCTION public.ensure_user_credits(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_credits WHERE user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'existing', true);
  END IF;

  SELECT subscription_tier INTO v_tier
  FROM public.profiles
  WHERE user_id = p_user_id;

  INSERT INTO public.user_credits (
    user_id,
    tier,
    monthly_credits_per_cycle,
    monthly_credits_used,
    bonus_credits_total,
    bonus_credits_used,
    reserved_monthly,
    reserved_bonus,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    COALESCE(v_tier, 'free'),
    10,
    0,
    5,
    0,
    0,
    0,
    now(),
    now()
  );

  RETURN jsonb_build_object('ok', true, 'created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_credits(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_credits(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_user_credits(UUID) TO authenticated;

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

  PERFORM public.ensure_user_credits(p_user_id);

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
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;

  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(reserved_monthly - v_res.monthly_credits_used, 0),
    reserved_bonus = GREATEST(reserved_bonus - v_res.bonus_credits_used, 0),
    monthly_credits_used = monthly_credits_used + v_res.monthly_credits_used,
    bonus_credits_used = bonus_credits_used + v_res.bonus_credits_used,
    updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'committed', metadata = metadata || p_metadata, updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  UPDATE public.profiles
  SET credits_balance = (v_monthly_after + v_bonus_after)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'tier', v_row.tier, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_reserved_credits(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_reserved_credits(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_reserved_credits(UUID, UUID, JSONB) TO authenticated;

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
  v_res public.credit_reservations%ROWTYPE;
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

  PERFORM public.ensure_user_credits(p_user_id);

  SELECT * INTO v_res
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_reservation');
  END IF;

  IF v_res.status = 'released' THEN
    RETURN jsonb_build_object('ok', true, 'already_refunded', true);
  END IF;

  IF v_res.status = 'reserved' THEN
    RETURN public.release_reserved_credits(p_user_id, p_request_id, p_reason, p_metadata);
  END IF;

  IF v_res.status <> 'committed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(monthly_credits_used - v_res.monthly_credits_used, 0),
    bonus_credits_used = GREATEST(bonus_credits_used - v_res.bonus_credits_used, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'released',
      metadata = (metadata || p_metadata) || jsonb_build_object('refund_reason', p_reason),
      updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  UPDATE public.profiles
  SET credits_balance = (v_monthly_after + v_bonus_after)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_monthly', v_res.monthly_credits_used,
    'refunded_bonus', v_res.bonus_credits_used,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_consumed_credits(UUID, UUID, TEXT, JSONB) TO authenticated;

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

  PERFORM public.ensure_user_credits(p_user_id);

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
    UPDATE public.profiles
    SET credits_balance = (v_monthly_after + v_bonus_after)
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
  END IF;

  IF v_res.status = 'committed' THEN
    RETURN public.refund_consumed_credits(p_user_id, p_request_id, p_reason, p_metadata);
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
    reserved_monthly = GREATEST(reserved_monthly - v_res.monthly_credits_used, 0),
    reserved_bonus = GREATEST(reserved_bonus - v_res.bonus_credits_used, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'released',
      metadata = (metadata || p_metadata) || jsonb_build_object('release_reason', p_reason),
      updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

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

REVOKE ALL ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO authenticated;

