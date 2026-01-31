-- When upgrading to a higher tier, carry over unused monthly credits as bonus.
-- On monthly renewal: flat allocation for the tier, usage resets, no accumulation.
CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_state(
  p_user_id UUID,
  p_tier public.credit_tier,
  p_customer_id TEXT,
  p_subscription_id TEXT,
  p_price_id TEXT,
  p_cycle_start TIMESTAMP WITH TIME ZONE,
  p_cycle_end TIMESTAMP WITH TIME ZONE,
  p_event_id TEXT,
  p_invoice_id TEXT DEFAULT NULL,
  p_reset_usage BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_per_cycle INTEGER;
  v_row public.user_credits%ROWTYPE;
  v_old_row public.user_credits%ROWTYPE;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
  v_bonus_amount INTEGER := 0;
  v_unused_monthly INTEGER := 0;
BEGIN
  v_per_cycle := public._credits_per_cycle_for_tier(p_tier);

  PERFORM public.ensure_user_credits(p_user_id);

  -- Read current state BEFORE updating (needed for upgrade carryover)
  SELECT * INTO v_old_row FROM public.user_credits WHERE user_id = p_user_id;

  -- On upgrade (higher credit allocation), carry over unused monthly credits as bonus
  IF p_reset_usage AND v_per_cycle > v_old_row.monthly_credits_per_cycle THEN
    v_unused_monthly := GREATEST(v_old_row.monthly_credits_per_cycle - v_old_row.monthly_credits_used, 0);

    IF v_unused_monthly > 0 THEN
      UPDATE public.user_credits
      SET bonus_credits_total = bonus_credits_total + v_unused_monthly
      WHERE user_id = p_user_id;

      INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, pool, stripe_event_id, stripe_invoice_id, stripe_subscription_id)
      VALUES (
        p_user_id,
        v_unused_monthly,
        'bonus',
        'Unused monthly credits carried over from upgrade',
        jsonb_build_object(
          'old_tier', v_old_row.tier,
          'new_tier', p_tier,
          'old_per_cycle', v_old_row.monthly_credits_per_cycle,
          'monthly_used', v_old_row.monthly_credits_used,
          'unused_carried_over', v_unused_monthly
        ),
        'bonus',
        p_event_id,
        p_invoice_id,
        p_subscription_id
      );
    END IF;
  END IF;

  UPDATE public.user_credits
  SET
    tier = p_tier,
    monthly_credits_per_cycle = v_per_cycle,
    cycle_start_at = p_cycle_start,
    cycle_end_at = p_cycle_end,
    cycle_source = 'stripe_subscription',
    stripe_customer_id = p_customer_id,
    stripe_subscription_id = p_subscription_id,
    stripe_price_id = p_price_id,
    monthly_credits_used = CASE WHEN p_reset_usage THEN 0 ELSE monthly_credits_used END
  WHERE user_id = p_user_id;

  IF p_reset_usage THEN
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, pool, stripe_event_id, stripe_invoice_id, stripe_subscription_id)
    VALUES (
      p_user_id,
      v_per_cycle,
      'subscription_grant',
      'Monthly credit allocation (Stripe)',
      jsonb_build_object('tier', p_tier, 'source', 'stripe', 'cycle_start', p_cycle_start, 'cycle_end', p_cycle_end, 'price_id', p_price_id),
      'monthly',
      p_event_id,
      p_invoice_id,
      p_subscription_id
    );
  ELSE
    INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, stripe_event_id, stripe_invoice_id, stripe_subscription_id)
    VALUES (
      p_user_id,
      0,
      'purchase',
      'Subscription state updated (Stripe)',
      jsonb_build_object('tier', p_tier, 'price_id', p_price_id),
      p_event_id,
      p_invoice_id,
      p_subscription_id
    );
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;

  IF (v_row.bonus_granted = FALSE) AND (p_reset_usage = TRUE) THEN
    IF p_tier = 'starter' THEN
      v_bonus_amount := 20;
    ELSIF p_tier = 'creator' THEN
      v_bonus_amount := 100;
    END IF;

    IF v_bonus_amount > 0 THEN
      UPDATE public.user_credits
      SET
        bonus_credits_total = bonus_credits_total + v_bonus_amount,
        bonus_granted = TRUE
      WHERE user_id = p_user_id;

      INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata, pool, stripe_event_id, stripe_invoice_id, stripe_subscription_id)
      VALUES (
        p_user_id,
        v_bonus_amount,
        'bonus',
        'One-time bonus credits (first subscription)',
        jsonb_build_object('tier', p_tier, 'source', 'stripe', 'price_id', p_price_id),
        'bonus',
        p_event_id,
        p_invoice_id,
        p_subscription_id
      );
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.user_credits WHERE user_id = p_user_id;
  v_monthly_after := GREATEST(v_row.monthly_credits_per_cycle - v_row.monthly_credits_used, 0);
  v_bonus_after := GREATEST(v_row.bonus_credits_total - v_row.bonus_credits_used, 0);

  RETURN jsonb_build_object('ok', true, 'tier', v_row.tier, 'remaining_monthly', v_monthly_after, 'remaining_bonus', v_bonus_after);
END;
$$;
