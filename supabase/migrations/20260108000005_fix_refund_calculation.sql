-- Fix refund calculation to handle positive/negative usage amounts and reservation splits correctly.
-- This supercedes the previous fix by correctly handling sign inconsistencies between commit_reserved_credits and consume_credits.

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
  v_usage_exists BOOLEAN := FALSE;
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

  -- Check if USAGE transaction exists (The Source of Truth for "Did we charge?")
  SELECT EXISTS(
    SELECT 1
    FROM public.credit_transactions ct
    WHERE ct.user_id = p_user_id
      AND ct.request_id = p_request_id
      AND ct.transaction_type = 'usage'
  ) INTO v_usage_exists;
  
  -- If usage exists: Refund it.
  IF v_usage_exists THEN
      -- Calculate Refund Amount
      IF v_has_reservation THEN
         -- For reservation flow, transaction might not have pool info, so use reservation record
         v_monthly_refund := COALESCE(v_res.monthly_credits_used, 0);
         v_bonus_refund := COALESCE(v_res.bonus_credits_used, 0);
      ELSE
         -- For direct consumption flow, transactions have pool and negative amounts
         -- Use ABS() to be safe against sign conventions
         SELECT
           COALESCE(SUM(CASE WHEN pool = 'monthly' THEN ABS(amount) ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN pool = 'bonus' THEN ABS(amount) ELSE 0 END), 0)
         INTO v_monthly_refund, v_bonus_refund
         FROM public.credit_transactions
         WHERE user_id = p_user_id
           AND request_id = p_request_id
           AND transaction_type = 'usage';
      END IF;

      -- Execute Refund
      SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
      
      UPDATE public.user_credits
      SET
        monthly_credits_used = GREATEST(COALESCE(monthly_credits_used, 0) - COALESCE(v_monthly_refund, 0), 0),
        bonus_credits_used = GREATEST(COALESCE(bonus_credits_used, 0) - COALESCE(v_bonus_refund, 0), 0),
        updated_at = now()
      WHERE user_id = p_user_id;

      -- Update reservation to released (if exists)
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

      -- Create Refund Transactions
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

      -- 0-Amount Refund (for logging purposes if cost was 0)
      IF v_monthly_refund = 0 AND v_bonus_refund = 0 THEN
         INSERT INTO public.credit_transactions (
           user_id, amount, transaction_type, description, metadata, pool, balance_monthly_after, balance_bonus_after, request_id
         ) VALUES (
           p_user_id, 0, 'refund', p_reason,
           p_metadata || jsonb_build_object('refund_of_request_id', p_request_id, 'refund_reason', p_reason, 'original_cost', 0, 'feature', CASE WHEN v_has_reservation THEN v_res.feature ELSE (p_metadata ->> 'feature') END),
           'monthly', v_monthly_after, v_bonus_after, p_request_id
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

  -- If nothing to refund and not reserved
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
