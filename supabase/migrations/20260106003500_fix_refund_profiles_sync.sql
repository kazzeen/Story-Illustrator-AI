-- Re-applying refund_consumed_credits with profiles sync
-- to ensure Frontend Header updates immediately.

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
  -- Strict Permission Check: Only the user themselves or service_role can request a refund
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  -- 1. Check if already refunded (idempotency)
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

  -- 2. Find the Usage to Refund
  SELECT
    COALESCE(SUM(CASE WHEN ct.pool = 'monthly' THEN -ct.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ct.pool = 'bonus' THEN -ct.amount ELSE 0 END), 0)
  INTO v_monthly_refund, v_bonus_refund
  FROM public.credit_transactions ct
  WHERE ct.user_id = p_user_id
    AND ct.request_id = p_request_id
    AND ct.transaction_type = 'usage';

  -- If no usage found, we can't refund
  IF COALESCE(v_monthly_refund, 0) <= 0 AND COALESCE(v_bonus_refund, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_usage_to_refund');
  END IF;

  PERFORM public.ensure_user_credits(p_user_id);

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_credit_account');
  END IF;

  -- Unlimited Tier check
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

  -- 3. Restore Credits to Balance
  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(monthly_credits_used - v_monthly_refund, 0),
    bonus_credits_used = GREATEST(bonus_credits_used - v_bonus_refund, 0)
  WHERE user_id = p_user_id;

  -- 4. Update Transaction Log
  UPDATE public.credit_transactions
  SET 
    transaction_type = 'released',
    amount = 0,
    description = p_reason,
    metadata = metadata || p_metadata || jsonb_build_object('refund_reason', p_reason, 'original_cost', (v_monthly_refund + v_bonus_refund)),
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'usage';

  -- Get final balance
  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);

  -- 5. Sync to Profiles (for Frontend Header)
  UPDATE public.profiles
  SET credits_balance = (v_monthly_after + v_bonus_after)
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_monthly', v_monthly_refund,
    'refunded_bonus', v_bonus_refund,
    'remaining_monthly', v_monthly_after,
    'remaining_bonus', v_bonus_after
  );
END;
$$;
