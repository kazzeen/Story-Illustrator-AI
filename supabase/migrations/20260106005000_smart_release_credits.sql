-- Upgrade release_reserved_credits to handle 'committed' reservations
-- by automatically refunding the usage. This solves the client-side issue
-- where committed credits failed to release.

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
    RETURN jsonb_build_object('ok', true, 'already_released', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
  END IF;

  -- SMART HANDLING: If status is 'committed', we should refund!
  IF v_res.status = 'committed' THEN
    -- Call the refund logic directly
    v_refund_res := public.refund_consumed_credits(p_user_id, p_request_id, p_reason, p_metadata);
    
    -- Also update the reservation status to released to keep things consistent
    UPDATE public.credit_reservations
    SET status = 'released', metadata = metadata || p_metadata || jsonb_build_object('release_reason', p_reason, 'converted_from', 'committed')
    WHERE request_id = p_request_id;
    
    RETURN v_refund_res;
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  -- Standard Case: Release a Reservation
  -- 1. Update User Credits (Release reservation)
  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(reserved_monthly - v_res.monthly_amount, 0),
    reserved_bonus = GREATEST(reserved_bonus - v_res.bonus_amount, 0)
  WHERE user_id = p_user_id;

  -- 2. Update Reservation Status
  UPDATE public.credit_reservations
  SET status = 'released', metadata = metadata || p_metadata || jsonb_build_object('release_reason', p_reason)
  WHERE request_id = p_request_id;

  -- 3. Update Transaction Log (Transform "Reservation" -> "Released" with 0 amount)
  UPDATE public.credit_transactions
  SET 
    transaction_type = 'release',
    amount = 0,
    description = COALESCE(p_reason, 'Credit reservation released'),
    metadata = (v_res.metadata || p_metadata) || jsonb_build_object('release_type', 'rollback'),
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'reservation';
  
  -- Sync to Profiles (just in case reservation change affects display, though usually it affects 'remaining')
  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);
  
  -- Update profiles balance
  UPDATE public.profiles
  SET credits_balance = (v_monthly_after + v_bonus_after)
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;
