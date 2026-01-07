-- Create the missing reserve_credits function
CREATE OR REPLACE FUNCTION public.reserve_credits(
  p_user_id UUID,
  p_request_id UUID,
  p_amount INTEGER,
  p_feature TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_credits%ROWTYPE;
  v_remaining_monthly INTEGER;
  v_remaining_bonus INTEGER;
  v_use_monthly INTEGER;
  v_use_bonus INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_id');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  -- Get user credits with row lock
  SELECT * INTO v_row
  FROM public.user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user_credits');
  END IF;

  -- Calculate remaining credits
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_row.reserved_monthly, 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_row.reserved_bonus, 0);

  -- Check if user has enough credits
  IF (v_remaining_monthly + v_remaining_bonus) < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credits', 'remaining_monthly', v_remaining_monthly, 'remaining_bonus', v_remaining_bonus);
  END IF;

  -- Determine how to split the reservation between monthly and bonus credits
  -- Use monthly credits first, then bonus credits
  IF v_remaining_monthly >= p_amount THEN
    v_use_monthly := p_amount;
    v_use_bonus := 0;
  ELSE
    v_use_monthly := v_remaining_monthly;
    v_use_bonus := p_amount - v_remaining_monthly;
  END IF;

  -- Update reserved credits
  UPDATE public.user_credits
  SET 
    reserved_monthly = reserved_monthly + v_use_monthly,
    reserved_bonus = reserved_bonus + v_use_bonus,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Create reservation record
  INSERT INTO public.credit_reservations (
    user_id,
    request_id,
    amount,
    monthly_credits_used,
    bonus_credits_used,
    feature,
    metadata,
    status,
    created_at
  ) VALUES (
    p_user_id,
    p_request_id,
    p_amount,
    v_use_monthly,
    v_use_bonus,
    p_feature,
    p_metadata,
    'reserved',
    now()
  );

  -- Calculate new remaining credits after reservation
  v_remaining_monthly := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used - v_use_monthly, 0);
  v_remaining_bonus := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used - v_use_bonus, 0);

  RETURN jsonb_build_object(
    'ok', true,
    'remaining_monthly', v_remaining_monthly,
    'remaining_bonus', v_remaining_bonus,
    'reserved_monthly', v_use_monthly,
    'reserved_bonus', v_use_bonus
  );
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, UUID, INTEGER, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, UUID, INTEGER, TEXT, JSONB) TO authenticated;