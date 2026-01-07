-- Migration to clean up credit transaction logging
-- Instead of separate "Usage" and "Release" entries, we now update the original "Reservation" entry.
-- This prevents the confuse double-deduction appearance in the transaction history.

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

  -- Idempotency
  IF v_res.status = 'committed' THEN
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
    v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);
    RETURN jsonb_build_object('ok', true, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after, 'idempotent', true);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;

  -- 1. Update User Credits (Move from Reserved to Used)
  UPDATE public.user_credits
  SET
    reserved_monthly = GREATEST(reserved_monthly - v_res.monthly_amount, 0),
    reserved_bonus = GREATEST(reserved_bonus - v_res.bonus_amount, 0),
    monthly_credits_used = monthly_credits_used + v_res.monthly_amount,
    bonus_credits_used = bonus_credits_used + v_res.bonus_amount
  WHERE user_id = p_user_id;

  -- 2. Update Reservation Status
  UPDATE public.credit_reservations
  SET status = 'committed', metadata = metadata || p_metadata
  WHERE request_id = p_request_id;

  -- 3. Update Transaction Log (Transform "Reservation" -> "Usage")
  -- This avoids creating a second net-negative entry.
  UPDATE public.credit_transactions
  SET 
    transaction_type = 'usage',
    description = COALESCE(v_res.description, 'Credit usage'),
    metadata = v_res.metadata || p_metadata,
    created_at = now() -- Update timestamp to show when it was actually used? Or keep reservation time? Keeping reservation time is often better for ordering, but updating shows "now". Let's keep ID but update content.
  WHERE request_id = p_request_id AND transaction_type = 'reservation';

  IF NOT FOUND THEN
     -- Fallback: If no reservation log exists, insert a fresh Usage log
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

  -- Recalculate balances for return
  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

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

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

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
  -- This effectively "voids" the transaction cost in the history.
  UPDATE public.credit_transactions
  SET 
    transaction_type = 'release',
    amount = 0, -- Set cost to 0 (Refunded/Voided)
    description = COALESCE(p_reason, 'Credit reservation released'),
    metadata = (v_res.metadata || p_metadata) || jsonb_build_object('release_type', 'rollback'),
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'reservation';
  
  -- If not found, we do nothing (because no cost was visible anyway)

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;
