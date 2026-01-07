-- Function to allow users to sync their own credits (trigger compensation for themselves)
CREATE OR REPLACE FUNCTION public.sync_user_credits()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authenticated');
  END IF;

  -- 1. Clean up any stuck "started" attempts that are older than 5 minutes
  -- This ensures the activity log shows "failed" instead of being stuck
  UPDATE public.image_generation_attempts
  SET 
    status = 'failed',
    error_message = 'Operation timed out',
    error_stage = 'timeout_cleanup',
    updated_at = now(),
    metadata = metadata || '{"cleanup_source": "sync_user_credits"}'::jsonb
  WHERE 
    user_id = v_user_id 
    AND status = 'started' 
    AND created_at < (now() - interval '5 minutes');

  -- 2. Run compensation for this user for the last 24 hours
  -- This fixes any stuck "reserved" or "committed" credits for failed generations
  PERFORM public.detect_and_compensate_failed_generations(v_user_id, 10080, false);

  -- 3. Return latest credit balance
  SELECT jsonb_build_object(
    'ok', true,
    'monthly', monthly_credits_per_cycle - monthly_credits_used - reserved_monthly,
    'bonus', bonus_credits_total - bonus_credits_used - reserved_bonus,
    'reserved_monthly', reserved_monthly,
    'reserved_bonus', reserved_bonus
  ) INTO v_result
  FROM public.user_credits
  WHERE user_id = v_user_id;

  IF v_result IS NULL THEN
     -- Handle case where user has no credit record yet
     RETURN jsonb_build_object('ok', true, 'monthly', 0, 'bonus', 0, 'reserved_monthly', 0, 'reserved_bonus', 0);
  END IF;
  
  RETURN v_result;
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.sync_user_credits() TO authenticated;

-- Try to schedule a cron job if pg_cron is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Run every 10 minutes
    PERFORM cron.schedule(
      'cleanup_stuck_generations',
      '*/10 * * * *',
      'SELECT public.detect_and_compensate_failed_generations(NULL, 1440, false)'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Ignore errors if pg_cron is not available or permissions are lacking
  RAISE NOTICE 'pg_cron not available or permission denied, skipping schedule';
END $$;
