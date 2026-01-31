-- Fix ultra_safe_commit_reserved_credits: profiles.id != profiles.user_id
-- The function used WHERE id = p_user_id on the profiles table, but the
-- correct column is user_id. This caused the credits_balance display sync
-- to silently update 0 rows on the generation-failure release path.
--
-- Also drop the orphaned deduct_credits function (not called anywhere).

CREATE OR REPLACE FUNCTION public.ultra_safe_commit_reserved_credits(
  p_user_id uuid,
  p_request_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.user_credits%ROWTYPE;
  v_res public.credit_reservations%ROWTYPE;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
  v_generation_status TEXT;
  v_error_message TEXT;
  v_validation_passed BOOLEAN := true;
  v_attempt_count INTEGER := 0;
  v_recent_attempt RECORD;
  v_transaction_count INTEGER := 0;
BEGIN
  -- Validate inputs
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  -- LAYER 1: IMMEDIATE VALIDATION CHECK
  v_validation_passed := COALESCE((p_metadata->>'validation_passed')::BOOLEAN, true);

  IF NOT v_validation_passed THEN
    RAISE NOTICE 'ULTRA_SAFE_COMMIT: Validation failed from metadata, releasing credits';
  END IF;

  -- LAYER 2: CHECK FOR EXISTING USAGE TRANSACTIONS (DOUBLE-CHARGE PREVENTION)
  SELECT COUNT(*) INTO v_transaction_count
  FROM public.credit_transactions
  WHERE request_id = p_request_id
    AND user_id = p_user_id
    AND transaction_type = 'usage';

  IF v_transaction_count > 0 THEN
    RAISE NOTICE 'ULTRA_SAFE_COMMIT: Found % existing usage transactions, blocking commit', v_transaction_count;

    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
    v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
    v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'usage_transactions_already_exist',
      'existing_transactions', v_transaction_count,
      'remaining_monthly', v_monthly_after,
      'remaining_bonus', v_bonus_after
    );
  END IF;

  -- LAYER 3: CHECK RECENT ATTEMPT STATUS
  SELECT status, error_message, created_at INTO v_generation_status, v_error_message, v_recent_attempt.created_at
  FROM public.image_generation_attempts
  WHERE request_id = p_request_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_generation_status = 'failed' OR v_error_message IS NOT NULL THEN
      RAISE NOTICE 'ULTRA_SAFE_COMMIT: Generation failed with status %, releasing credits', v_generation_status;
      v_validation_passed := false;
    END IF;

    IF NOT v_validation_passed THEN
      SELECT * INTO v_res
      FROM public.credit_reservations
      WHERE request_id = p_request_id AND user_id = p_user_id
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.user_credits
        SET
          reserved_monthly = GREATEST(reserved_monthly - v_res.monthly_amount, 0),
          reserved_bonus = GREATEST(reserved_bonus - v_res.bonus_amount, 0)
        WHERE user_id = p_user_id;

        UPDATE public.credit_reservations
        SET status = 'released',
            metadata = metadata || p_metadata || jsonb_build_object(
              'release_reason', CASE
                WHEN v_generation_status = 'failed' THEN 'generation_failed_preemptive'
                ELSE 'validation_failed_preemptive'
              END,
              'error_message', v_error_message
            )
        WHERE request_id = p_request_id;

        SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
        v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
        v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

        -- FIX: was WHERE id = p_user_id (wrong — profiles.id != profiles.user_id)
        UPDATE public.profiles
        SET credits_balance = (v_monthly_after + v_bonus_after)
        WHERE user_id = p_user_id;

        RETURN jsonb_build_object(
          'ok', false,
          'reason', CASE
            WHEN v_generation_status = 'failed' THEN 'generation_failed'
            ELSE 'validation_failed'
          END,
          'error_message', v_error_message,
          'remaining_monthly', v_monthly_after,
          'remaining_bonus', v_bonus_after
        );
      ELSE
        SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
        v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
        v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'no_reservation_found_for_failed_generation',
          'error_message', v_error_message,
          'remaining_monthly', v_monthly_after,
          'remaining_bonus', v_bonus_after
        );
      END IF;
    END IF;
  END IF;

  -- LAYER 4: FINAL SAFETY CHECK
  SELECT * INTO v_res
  FROM public.credit_reservations
  WHERE request_id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE request_id = p_request_id
      AND user_id = p_user_id
      AND transaction_type = 'usage'
    ) THEN
      SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
      v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
      v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);
      RETURN jsonb_build_object(
        'ok', true,
        'tier', v_row.tier,
        'remaining_monthly', v_monthly_after,
        'remaining_bonus', v_bonus_after,
        'idempotent', true,
        'note', 'already_committed'
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.credit_reservations
      WHERE request_id = p_request_id AND user_id = p_user_id AND status = 'released'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'reservation_already_released');
    END IF;

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

  IF v_res.status = 'released' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reservation_already_released');
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reservation_state', 'status', v_res.status);
  END IF;

  -- LAYER 5: FINAL COMMIT
  RAISE NOTICE 'ULTRA_SAFE_COMMIT: Proceeding with credit commit for successful generation';

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
      user_id, amount, transaction_type, description, metadata,
      pool, balance_monthly_after, balance_bonus_after, request_id
    ) VALUES (
      p_user_id, -v_res.monthly_amount, 'usage',
      COALESCE(v_res.description, 'Credit usage'),
      v_res.metadata || p_metadata, 'monthly',
      v_monthly_after, v_bonus_after, p_request_id
    );
  END IF;

  IF v_res.bonus_amount > 0 THEN
    INSERT INTO public.credit_transactions (
      user_id, amount, transaction_type, metadata,
      pool, balance_monthly_after, balance_bonus_after, request_id
    ) VALUES (
      p_user_id, -v_res.bonus_amount, 'usage',
      v_res.metadata || p_metadata, 'bonus',
      v_monthly_after, v_bonus_after, p_request_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tier', v_row.tier,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$function$;

-- Drop orphaned legacy function (not called by any code or database function)
DROP FUNCTION IF EXISTS public.deduct_credits(uuid, integer, text, jsonb);
