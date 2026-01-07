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
  v_remaining_monthly INTEGER;
  v_remaining_bonus INTEGER;
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
    IF EXISTS (
      SELECT 1
      FROM public.credit_transactions ct
      WHERE ct.user_id = p_user_id
        AND ct.request_id = p_request_id
        AND ct.transaction_type IN ('release', 'released', 'refund')
    ) THEN
      SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
      v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
      v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
      UPDATE public.profiles
      SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
      WHERE user_id = p_user_id;
      RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
    END IF;

    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      0,
      'release',
      COALESCE(p_reason, 'Generation failed'),
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('release_reason', p_reason, 'missing_reservation', true),
      p_request_id
    );

    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
    v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
    UPDATE public.profiles
    SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'ok', true,
      'missing_reservation', true,
      'remaining_monthly', v_remaining_monthly,
      'remaining_bonus', v_remaining_bonus
    );
  END IF;

  IF v_res.status = 'released' THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
    v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
    UPDATE public.profiles
    SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
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
    reserved_monthly = GREATEST(COALESCE(reserved_monthly, 0) - v_res.monthly_credits_used, 0),
    reserved_bonus = GREATEST(COALESCE(reserved_bonus, 0) - v_res.bonus_credits_used, 0),
    updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.credit_reservations
  SET status = 'released',
      metadata = (COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb)) || jsonb_build_object('release_reason', p_reason),
      updated_at = now()
  WHERE request_id = p_request_id AND user_id = p_user_id;

  UPDATE public.credit_transactions
  SET
    transaction_type = 'release',
    amount = 0,
    description = COALESCE(p_reason, 'Credit reservation released'),
    metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('feature', v_res.feature, 'release_reason', p_reason)
  WHERE user_id = p_user_id AND request_id = p_request_id AND transaction_type = 'reservation';

  IF NOT FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, request_id)
    VALUES (
      p_user_id,
      0,
      'release',
      COALESCE(p_reason, 'Credit reservation released'),
      (COALESCE(v_res.metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('feature', v_res.feature, 'release_reason', p_reason)),
      p_request_id
    );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  UPDATE public.profiles
  SET credits_balance = (v_remaining_monthly + v_remaining_bonus)
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_reserved_credits(UUID, UUID, TEXT, JSONB) TO service_role;

