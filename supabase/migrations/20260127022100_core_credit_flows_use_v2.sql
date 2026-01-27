CREATE OR REPLACE FUNCTION public.ensure_profile_credits_initialized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_user_credits_v2(NEW.user_id);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'credits_initialization_failed' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_user_credits_cycle(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := now();
  v_row public.user_credits%ROWTYPE;
  v_start TIMESTAMP WITH TIME ZONE;
  v_end TIMESTAMP WITH TIME ZONE;
  v_anchor TIMESTAMP WITH TIME ZONE;
  v_window RECORD;
  v_per_cycle INTEGER;
  v_did_reset BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.ensure_user_credits_v2(p_user_id);
    SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  IF v_row.cycle_source = 'profile_created' THEN
    SELECT created_at INTO v_anchor FROM public.profiles WHERE user_id = p_user_id;
    IF v_anchor IS NULL THEN
      v_anchor := v_row.cycle_start_at;
    END IF;
    SELECT cycle_start, cycle_end INTO v_window
    FROM public._compute_basic_cycle_window(v_anchor, v_now);

    v_start := v_window.cycle_start;
    v_end := v_window.cycle_end;
  ELSE
    v_start := v_row.cycle_start_at;
    v_end := v_row.cycle_end_at;
    WHILE v_end <= v_now LOOP
      v_start := v_end;
      v_end := v_end + INTERVAL '1 month';
      v_did_reset := TRUE;
    END LOOP;
  END IF;

  IF v_row.cycle_end_at <= v_now OR v_row.cycle_start_at <> v_start OR v_row.cycle_end_at <> v_end THEN
    v_did_reset := TRUE;
  END IF;

  IF NOT v_did_reset THEN
    RETURN;
  END IF;

  v_per_cycle := public._credits_per_cycle_for_tier(v_row.tier);

  UPDATE public.user_credits
  SET
    cycle_start_at = v_start,
    cycle_end_at = v_end,
    monthly_credits_per_cycle = v_per_cycle,
    monthly_credits_used = 0
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, pool)
  VALUES (
    p_user_id,
    v_per_cycle,
    'subscription_grant',
    'Monthly credit allocation',
    jsonb_build_object('tier', v_row.tier, 'source', 'cycle_reset', 'cycle_start', v_start, 'cycle_end', v_end),
    'monthly'
  );
END;
$$;

