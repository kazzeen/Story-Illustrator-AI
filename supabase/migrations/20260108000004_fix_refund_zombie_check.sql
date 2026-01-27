-- Fix refund logic to handle "Zombie" credits (released but not refunded)
-- and ensure logging continuity by returning ok:true even if no refund needed.

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
  v_remaining_monthly INTEGER;
  v_remaining_bonus INTEGER;
  v_monthly_refund INTEGER := 0;
  v_bonus_refund INTEGER := 0;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
  v_has_reservation BOOLEAN := FALSE;
BEGIN
  -- Basic checks
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

  -- Check for existing REFUND transaction (Idempotency)
  IF EXISTS (
    SELECT 1
    FROM public.credit_transactions ct
    WHERE ct.user_id = p_user_id
      AND ct.request_id = p_request_id
      AND ct.transaction_type = 'refund'
      AND (ct.metadata ->> 'refund_of_request_id') = (p_request_id::text)
  ) THEN
     SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
     v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
     v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
     RETURN jsonb_build_object(
       'ok', true, 
       'already_refunded', true, 
       'remaining_monthly', v_remaining_monthly, 
       'remaining_bonus', v_remaining_bonus
     );
  END IF;

  -- Lock Reservation
  SELECT * INTO v_res
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    v_has_reservation := TRUE;
  END IF;

  -- Calculate Usage to Refund (The Source of Truth)
  -- Usage is negative, so we negate it to get positive refund amount
  SELECT
    COALESCE(SUM(CASE WHEN ct.pool = 'monthly' THEN -ct.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ct.pool = 'bonus' THEN -ct.amount ELSE 0 END), 0)
  INTO v_monthly_refund, v_bonus_refund
  FROM public.credit_transactions ct
  WHERE ct.user_id = p_user_id
    AND ct.request_id = p_request_id
    AND ct.transaction_type = 'usage';
  
  -- If usage > 0: Refund it.
  IF COALESCE(v_monthly_refund, 0) > 0 OR COALESCE(v_bonus_refund, 0) > 0 THEN
      SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
      IF NOT FOUND THEN
         RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
      END IF;
      
      UPDATE public.user_credits
      SET
        monthly_credits_used = GREATEST(COALESCE(monthly_credits_used, 0) - COALESCE(v_monthly_refund, 0), 0),
        bonus_credits_used = GREATEST(COALESCE(bonus_credits_used, 0) - COALESCE(v_bonus_refund, 0), 0),
        updated_at = now()
      WHERE user_id = p_user_id;

      IF v_has_reservation AND v_res.status <> 'released' THEN
        UPDATE public.credit_reservations
        SET
          status = 'released',
          metadata = (metadata || p_metadata) || jsonb_build_object('refund_reason', p_reason),
          updated_at = now()
        WHERE request_id = p_request_id AND user_id = p_user_id;
      END IF;
      
      SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
      v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
      v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);
      v_monthly_after := v_remaining_monthly;
      v_bonus_after := v_remaining_bonus;

      IF v_monthly_refund > 0 THEN
        INSERT INTO public.credit_transactions (
          user_id, amount, transaction_type, description, metadata, pool, balance_monthly_after, balance_bonus_after, request_id
        ) VALUES (
          p_user_id, v_monthly_refund, 'refund', p_reason,
          p_metadata || jsonb_build_object('refund_of_request_id', p_request_id, 'refund_reason', p_reason, 'original_cost', (v_monthly_refund + v_bonus_refund), 'feature', CASE WHEN v_has_reservation THEN v_res.feature ELSE (p_metadata ->> 'feature') END),
          'monthly', v_monthly_after, v_bonus_after, p_request_id
        );
      END IF;

      IF v_bonus_refund > 0 THEN
        INSERT INTO public.credit_transactions (
          user_id, amount, transaction_type, description, metadata, pool, balance_monthly_after, balance_bonus_after, request_id
        ) VALUES (
          p_user_id, v_bonus_refund, 'refund', p_reason,
          p_metadata || jsonb_build_object('refund_of_request_id', p_request_id, 'refund_reason', p_reason, 'original_cost', (v_monthly_refund + v_bonus_refund), 'feature', CASE WHEN v_has_reservation THEN v_res.feature ELSE (p_metadata ->> 'feature') END),
          'bonus', v_monthly_after, v_bonus_after, p_request_id
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', true,
        'refunded_monthly', v_monthly_refund,
        'refunded_bonus', v_bonus_refund,
        'remaining_monthly', v_remaining_monthly,
        'remaining_bonus', v_remaining_bonus
      );
  END IF;

  -- NO USAGE FOUND
  
  IF v_has_reservation AND v_res.status = 'reserved' THEN
    RETURN public.release_reserved_credits(p_user_id, p_request_id, p_reason, p_metadata);
  END IF;

  -- If nothing to refund and not reserved (e.g. released or committed-but-0-usage),
  -- we return OK so that calling code (logging) can proceed.
  
  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - COALESCE(v_row.reserved_monthly, 0), 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - COALESCE(v_row.reserved_bonus, 0), 0);

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_monthly', 0,
    'refunded_bonus', 0,
    'remaining_monthly', v_remaining_monthly,
    'remaining_bonus', v_remaining_bonus,
    'message', 'no_usage_to_refund'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.force_refund_credits(
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
  v_refund_res JSONB;
  v_combined_metadata JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  v_combined_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('forced_refund', true, 'refund_timestamp', now());

  -- Attempt Refund Consumption (Safe & Robust now)
  -- This handles both Refund (if usage exists) and Release (if reserved)
  v_refund_res := public.refund_consumed_credits(
    p_user_id,
    p_request_id,
    p_reason,
    v_combined_metadata
  );

  RETURN jsonb_build_object(
    'ok', true,
    'refund_result', v_refund_res,
    'summary', CASE
      WHEN (v_refund_res->>'refunded_monthly')::int > 0 OR (v_refund_res->>'refunded_bonus')::int > 0 THEN 'refunded'
      WHEN (v_refund_res->>'already_refunded')::boolean THEN 'already_refunded'
      WHEN (v_refund_res->>'released')::boolean THEN 'released'
      ELSE 'no_action_needed'
    END
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'reason', 'exception',
    'error', SQLERRM,
    'details', SQLSTATE
  );
END;
$$;
