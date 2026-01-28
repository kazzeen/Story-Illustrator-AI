
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
      u.email::text, -- Cast to text to match return type
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
