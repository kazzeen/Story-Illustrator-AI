CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20,
  p_query TEXT DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'created_at',
  p_sort_dir TEXT DEFAULT 'desc',
  p_plan_tier TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_activity TEXT DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  plan_tier TEXT,
  plan_status TEXT,
  credits_balance INTEGER,
  stories_count BIGINT,
  scenes_count BIGINT,
  last_activity_at TIMESTAMP WITH TIME ZONE,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_page INTEGER := GREATEST(COALESCE(p_page, 1), 1);
  v_page_size INTEGER := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 200);
  v_offset INTEGER := (v_page - 1) * v_page_size;
  v_query TEXT := NULLIF(btrim(COALESCE(p_query, '')), '');
  v_sort_by TEXT := lower(COALESCE(p_sort_by, 'created_at'));
  v_sort_dir TEXT := lower(COALESCE(p_sort_dir, 'desc'));
  v_plan TEXT := NULLIF(lower(btrim(COALESCE(p_plan_tier, ''))), '');
  v_status TEXT := NULLIF(lower(btrim(COALESCE(p_status, ''))), '');
  v_activity TEXT := NULLIF(lower(btrim(COALESCE(p_activity, ''))), '');
BEGIN
  RETURN QUERY
  WITH story_stats AS (
    SELECT s.user_id, count(*)::bigint AS stories_count, max(s.updated_at) AS last_activity_at
    FROM public.stories s
    GROUP BY s.user_id
  ),
  scene_stats AS (
    SELECT st.user_id, count(sc.*)::bigint AS scenes_count
    FROM public.stories st
    JOIN public.scenes sc ON sc.story_id = st.id
    GROUP BY st.user_id
  ),
  base AS (
    SELECT
      u.id AS user_id,
      u.email,
      u.created_at,
      u.last_sign_in_at AS last_login_at,
      p.subscription_tier AS plan_tier,
      p.subscription_status AS plan_status,
      p.credits_balance,
      COALESCE(ss.stories_count, 0) AS stories_count,
      COALESCE(cs.scenes_count, 0) AS scenes_count,
      ss.last_activity_at
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    LEFT JOIN story_stats ss ON ss.user_id = u.id
    LEFT JOIN scene_stats cs ON cs.user_id = u.id
    WHERE
      (
        v_query IS NULL OR
        (u.email IS NOT NULL AND u.email ILIKE ('%' || v_query || '%')) OR
        (u.id::text ILIKE ('%' || v_query || '%'))
      )
      AND (v_plan IS NULL OR lower(COALESCE(p.subscription_tier, '')) = v_plan)
      AND (v_status IS NULL OR lower(COALESCE(p.subscription_status, '')) = v_status)
      AND (
        v_activity IS NULL OR
        (v_activity = 'active' AND ss.last_activity_at >= now() - interval '30 days') OR
        (v_activity = 'inactive' AND (ss.last_activity_at IS NULL OR ss.last_activity_at < now() - interval '30 days'))
      )
  )
  SELECT
    b.user_id,
    b.email,
    b.created_at,
    b.last_login_at,
    b.plan_tier,
    b.plan_status,
    b.credits_balance,
    b.stories_count,
    b.scenes_count,
    b.last_activity_at,
    count(*) OVER () AS total_count
  FROM base b
  ORDER BY
    CASE WHEN v_sort_by = 'email' AND v_sort_dir = 'asc' THEN b.email END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'email' AND v_sort_dir = 'desc' THEN b.email END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'created_at' AND v_sort_dir = 'asc' THEN b.created_at END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'created_at' AND v_sort_dir = 'desc' THEN b.created_at END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'last_login_at' AND v_sort_dir = 'asc' THEN b.last_login_at END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'last_login_at' AND v_sort_dir = 'desc' THEN b.last_login_at END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'plan_tier' AND v_sort_dir = 'asc' THEN b.plan_tier END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'plan_tier' AND v_sort_dir = 'desc' THEN b.plan_tier END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'credits_balance' AND v_sort_dir = 'asc' THEN b.credits_balance END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'credits_balance' AND v_sort_dir = 'desc' THEN b.credits_balance END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'stories_count' AND v_sort_dir = 'asc' THEN b.stories_count END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'stories_count' AND v_sort_dir = 'desc' THEN b.stories_count END DESC NULLS LAST,
    CASE WHEN v_sort_by = 'scenes_count' AND v_sort_dir = 'asc' THEN b.scenes_count END ASC NULLS LAST,
    CASE WHEN v_sort_by = 'scenes_count' AND v_sort_dir = 'desc' THEN b.scenes_count END DESC NULLS LAST,
    b.created_at DESC
  OFFSET v_offset
  LIMIT v_page_size;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_user_details(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user RECORD;
  v_stories_count BIGINT;
  v_scenes_count BIGINT;
  v_last_activity_at TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT
    u.id AS user_id,
    u.email,
    u.created_at,
    u.last_sign_in_at AS last_login_at,
    p.subscription_tier AS plan_tier,
    p.subscription_status AS plan_status,
    p.credits_balance,
    p.next_billing_date AS plan_expires_at
  INTO v_user
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.id = p_user_id;

  IF v_user.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT count(*)::bigint INTO v_stories_count FROM public.stories s WHERE s.user_id = p_user_id;
  SELECT max(s.updated_at) INTO v_last_activity_at FROM public.stories s WHERE s.user_id = p_user_id;
  SELECT count(*)::bigint INTO v_scenes_count
  FROM public.scenes sc
  JOIN public.stories st ON st.id = sc.story_id
  WHERE st.user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object(
      'user_id', v_user.user_id,
      'email', v_user.email,
      'created_at', v_user.created_at,
      'last_login_at', v_user.last_login_at,
      'plan_tier', v_user.plan_tier,
      'plan_status', v_user.plan_status,
      'plan_expires_at', v_user.plan_expires_at,
      'credits_balance', v_user.credits_balance,
      'stories_count', v_stories_count,
      'scenes_count', v_scenes_count,
      'last_activity_at', v_last_activity_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_modify_user_credits(
  p_user_id UUID,
  p_operation TEXT,
  p_amount INTEGER,
  p_admin_username TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op TEXT := lower(btrim(COALESCE(p_operation, '')));
  v_amount INTEGER := COALESCE(p_amount, 0);
  v_uc public.user_credits%ROWTYPE;
  v_monthly_remaining INTEGER;
  v_bonus_remaining INTEGER;
  v_total_before INTEGER;
  v_total_after INTEGER;
  v_bonus_total_before INTEGER;
  v_bonus_total_after INTEGER;
  v_monthly_used_after INTEGER;
  v_profile_tier TEXT;
BEGIN
  IF v_op NOT IN ('add', 'deduct', 'set') THEN
    RAISE EXCEPTION 'invalid_operation';
  END IF;

  IF v_op IN ('add', 'deduct') AND v_amount = 0 THEN
    RAISE EXCEPTION 'amount_required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text)::bigint);

  PERFORM public.ensure_user_credits_v2(p_user_id);
  SELECT * INTO v_uc FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;

  v_monthly_remaining := GREATEST(v_uc.monthly_credits_per_cycle - v_uc.monthly_credits_used - COALESCE(v_uc.reserved_monthly, 0), 0);
  v_bonus_remaining := GREATEST(v_uc.bonus_credits_total - v_uc.bonus_credits_used - COALESCE(v_uc.reserved_bonus, 0), 0);
  v_total_before := v_monthly_remaining + v_bonus_remaining;
  v_bonus_total_before := v_uc.bonus_credits_total;

  IF v_op = 'add' THEN
    v_bonus_total_after := v_uc.bonus_credits_total + v_amount;
    v_monthly_used_after := v_uc.monthly_credits_used;
  ELSIF v_op = 'deduct' THEN
    v_bonus_total_after := v_uc.bonus_credits_total - v_amount;
    v_monthly_used_after := v_uc.monthly_credits_used;
  ELSE
    IF v_amount < 0 THEN
      RAISE EXCEPTION 'amount_must_be_non_negative';
    END IF;

    IF v_amount >= v_monthly_remaining THEN
      v_monthly_used_after := v_uc.monthly_credits_used;
      v_bonus_total_after := GREATEST(v_uc.bonus_credits_used + COALESCE(v_uc.reserved_bonus, 0) + (v_amount - v_monthly_remaining), 0);
    ELSE
      v_bonus_total_after := GREATEST(v_uc.bonus_credits_used + COALESCE(v_uc.reserved_bonus, 0), 0);
      v_monthly_used_after := LEAST(GREATEST(v_uc.monthly_credits_per_cycle - COALESCE(v_uc.reserved_monthly, 0) - v_amount, 0), v_uc.monthly_credits_per_cycle);
    END IF;
  END IF;

  v_bonus_total_after := GREATEST(v_bonus_total_after, v_uc.bonus_credits_used + COALESCE(v_uc.reserved_bonus, 0));

  UPDATE public.user_credits
  SET
    bonus_credits_total = v_bonus_total_after,
    monthly_credits_used = v_monthly_used_after,
    updated_at = now()
  WHERE user_id = p_user_id;

  SELECT * INTO v_uc FROM public.user_credits WHERE user_id = p_user_id;

  v_monthly_remaining := GREATEST(v_uc.monthly_credits_per_cycle - v_uc.monthly_credits_used - COALESCE(v_uc.reserved_monthly, 0), 0);
  v_bonus_remaining := GREATEST(v_uc.bonus_credits_total - v_uc.bonus_credits_used - COALESCE(v_uc.reserved_bonus, 0), 0);
  v_total_after := v_monthly_remaining + v_bonus_remaining;

  v_profile_tier := CASE WHEN v_uc.tier = 'basic' THEN 'free' ELSE v_uc.tier::text END;
  UPDATE public.profiles
  SET
    credits_balance = v_total_after,
    subscription_tier = COALESCE(subscription_tier, v_profile_tier),
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    metadata,
    pool,
    balance_monthly_after,
    balance_bonus_after
  ) VALUES (
    p_user_id,
    (v_total_after - v_total_before),
    'adjustment',
    'Admin credit adjustment',
    jsonb_build_object(
      'operation', v_op,
      'admin_username', p_admin_username,
      'reason', p_reason,
      'total_before', v_total_before,
      'total_after', v_total_after,
      'bonus_total_before', v_bonus_total_before,
      'bonus_total_after', v_bonus_total_after
    ),
    'bonus',
    v_monthly_remaining,
    v_bonus_remaining
  );

  INSERT INTO public.audit_logs (
    admin_username,
    action_type,
    target_user_id,
    reason,
    before,
    after
  ) VALUES (
    p_admin_username,
    'credits.modify',
    p_user_id,
    p_reason,
    jsonb_build_object('credits_total', v_total_before, 'bonus_total', v_bonus_total_before),
    jsonb_build_object('credits_total', v_total_after, 'bonus_total', v_bonus_total_after)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'total_before', v_total_before,
    'total_after', v_total_after
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_plan(
  p_user_id UUID,
  p_new_tier TEXT DEFAULT NULL,
  p_new_status TEXT DEFAULT NULL,
  p_new_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_admin_username TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_old_tier TEXT;
  v_old_status TEXT;
  v_old_expires TIMESTAMP WITH TIME ZONE;
  v_new_tier TEXT;
  v_new_status TEXT;
  v_credit_tier public.credit_tier;
  v_per_cycle INTEGER;
  v_uc public.user_credits%ROWTYPE;
  v_monthly_after INTEGER;
  v_bonus_after INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text)::bigint);

  SELECT
    p.subscription_tier,
    p.subscription_status,
    p.next_billing_date
  INTO v_profile
  FROM public.profiles p
  WHERE p.user_id = p_user_id
  FOR UPDATE;

  IF v_profile.subscription_tier IS NULL AND v_profile.subscription_status IS NULL AND v_profile.next_billing_date IS NULL THEN
    PERFORM 1 FROM public.profiles p WHERE p.user_id = p_user_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
  END IF;

  v_old_tier := v_profile.subscription_tier;
  v_old_status := v_profile.subscription_status;
  v_old_expires := v_profile.next_billing_date;

  v_new_tier := NULLIF(btrim(COALESCE(p_new_tier, '')), '');
  v_new_status := NULLIF(btrim(COALESCE(p_new_status, '')), '');

  UPDATE public.profiles
  SET
    subscription_tier = COALESCE(v_new_tier, subscription_tier),
    subscription_status = COALESCE(v_new_status, subscription_status),
    next_billing_date = COALESCE(p_new_expires_at, next_billing_date),
    updated_at = now()
  WHERE user_id = p_user_id;

  IF v_new_tier IS NOT NULL THEN
    v_credit_tier := CASE lower(v_new_tier)
      WHEN 'starter' THEN 'starter'
      WHEN 'creator' THEN 'creator'
      WHEN 'professional' THEN 'professional'
      WHEN 'basic' THEN 'basic'
      WHEN 'free' THEN 'basic'
      ELSE 'basic'
    END;

    v_per_cycle := public._credits_per_cycle_for_tier(v_credit_tier);

    PERFORM public.ensure_user_credits_v2(p_user_id);
    SELECT * INTO v_uc FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;

    UPDATE public.user_credits
    SET
      tier = v_credit_tier,
      monthly_credits_per_cycle = v_per_cycle,
      updated_at = now()
    WHERE user_id = p_user_id;

    SELECT * INTO v_uc FROM public.user_credits WHERE user_id = p_user_id;
    v_monthly_after := GREATEST(v_uc.monthly_credits_per_cycle - v_uc.monthly_credits_used - COALESCE(v_uc.reserved_monthly, 0), 0);
    v_bonus_after := GREATEST(v_uc.bonus_credits_total - v_uc.bonus_credits_used - COALESCE(v_uc.reserved_bonus, 0), 0);

    UPDATE public.profiles
    SET
      credits_balance = (v_monthly_after + v_bonus_after),
      subscription_tier = v_new_tier,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  INSERT INTO public.plan_history (
    user_id,
    admin_username,
    old_tier,
    new_tier,
    old_status,
    new_status,
    old_expires_at,
    new_expires_at,
    notes
  ) VALUES (
    p_user_id,
    COALESCE(p_admin_username, 'admin'),
    v_old_tier,
    COALESCE(v_new_tier, v_old_tier),
    v_old_status,
    COALESCE(v_new_status, v_old_status),
    v_old_expires,
    COALESCE(p_new_expires_at, v_old_expires),
    p_notes
  );

  INSERT INTO public.audit_logs (
    admin_username,
    action_type,
    target_user_id,
    reason,
    before,
    after
  ) VALUES (
    COALESCE(p_admin_username, 'admin'),
    'plan.update',
    p_user_id,
    p_notes,
    jsonb_build_object('subscription_tier', v_old_tier, 'subscription_status', v_old_status, 'next_billing_date', v_old_expires),
    jsonb_build_object('subscription_tier', COALESCE(v_new_tier, v_old_tier), 'subscription_status', COALESCE(v_new_status, v_old_status), 'next_billing_date', COALESCE(p_new_expires_at, v_old_expires))
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
