-- Force Refund RPC
-- A simplified, aggressive refund function to ensure credits are returned.

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
  -- Find the usage
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

  -- Verify ownership (unless service_role)
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  -- Restore Credits
  UPDATE public.user_credits
  SET
    monthly_credits_used = GREATEST(monthly_credits_used - v_usage_monthly, 0),
    bonus_credits_used = GREATEST(bonus_credits_used - v_usage_bonus, 0)
  WHERE user_id = v_user_id;

  -- Update Transaction
  UPDATE public.credit_transactions
  SET 
    transaction_type = 'released',
    amount = 0,
    description = p_reason,
    updated_at = now()
  WHERE request_id = p_request_id AND transaction_type = 'usage';
  
  -- Update Reservation if exists (cleanup)
  UPDATE public.credit_reservations
  SET status = 'released'
  WHERE request_id = p_request_id;
  
  -- Sync Profile
  SELECT * INTO v_row FROM public.user_credits WHERE user_id = v_user_id;
  UPDATE public.profiles
  SET credits_balance = GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0) + 
                        GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0)
  WHERE id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'refunded', v_usage_monthly + v_usage_bonus);
END;
$$;

GRANT EXECUTE ON FUNCTION public.force_refund_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_refund_request(UUID, TEXT) TO service_role;
