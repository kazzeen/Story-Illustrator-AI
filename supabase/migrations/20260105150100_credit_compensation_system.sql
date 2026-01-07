-- Comprehensive credit compensation system
-- Provides automated detection and rollback of credit deductions for failed generations

-- Function to detect and compensate orphaned credit reservations
-- This handles cases where:
-- 1. Credits were reserved but generation failed without proper release
-- 2. Credits were committed but generation actually failed
-- 3. Race conditions left credits in an inconsistent state

CREATE OR REPLACE FUNCTION public.detect_and_compensate_failed_generations(
  p_user_id UUID DEFAULT NULL,
  p_lookback_minutes INTEGER DEFAULT 60,
  p_dry_run BOOLEAN DEFAULT true
)
RETURNS TABLE (
  request_id UUID,
  user_id UUID,
  feature TEXT,
  status TEXT,
  reservation_status TEXT,
  credits_amount INTEGER,
  action_taken TEXT,
  details JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMP WITH TIME ZONE;
  v_record RECORD;
  v_reservation RECORD;
  v_usage_count INTEGER;
  v_refund_result JSONB;
  v_release_result JSONB;
BEGIN
  v_cutoff := now() - (p_lookback_minutes || ' minutes')::interval;

  -- Find failed generation attempts that might have credit issues
  FOR v_record IN
    SELECT 
      iga.request_id,
      iga.user_id,
      iga.feature,
      iga.status,
      iga.credits_amount,
      iga.error_stage,
      iga.error_message,
      iga.created_at,
      cr.status AS reservation_status,
      cr.amount AS reserved_amount,
      cr.monthly_amount,
      cr.bonus_amount
    FROM public.image_generation_attempts iga
    LEFT JOIN public.credit_reservations cr 
      ON cr.request_id = iga.request_id AND cr.user_id = iga.user_id
    WHERE 
      iga.status = 'failed'
      AND iga.created_at >= v_cutoff
      AND (p_user_id IS NULL OR iga.user_id = p_user_id)
      -- Only process if there's a potential credit issue
      AND (
        -- Case 1: Reservation exists and is still 'reserved' (should have been released)
        cr.status = 'reserved'
        -- Case 2: Reservation exists and was 'committed' for a failed generation
        OR cr.status = 'committed'
      )
    ORDER BY iga.created_at DESC
    FOR UPDATE OF iga SKIP LOCKED
  LOOP
    request_id := v_record.request_id;
    user_id := v_record.user_id;
    feature := v_record.feature;
    status := v_record.status;
    reservation_status := v_record.reservation_status;
    credits_amount := v_record.credits_amount;
    
    IF v_record.reservation_status = 'reserved' THEN
      -- Case: Reservation was never released - release it now
      action_taken := CASE WHEN p_dry_run THEN 'would_release' ELSE 'released' END;
      details := jsonb_build_object(
        'error_stage', v_record.error_stage,
        'error_message', v_record.error_message,
        'reserved_amount', v_record.reserved_amount,
        'compensation_type', 'release_stale_reservation'
      );

      IF NOT p_dry_run THEN
        v_release_result := public.release_reserved_credits(
          v_record.user_id,
          v_record.request_id,
          'Compensation: Unreleased reservation for failed generation',
          jsonb_build_object(
            'compensation_source', 'detect_and_compensate_failed_generations',
            'original_error_stage', v_record.error_stage,
            'original_error_message', v_record.error_message,
            'compensation_timestamp', now()
          )
        );

        details := details || jsonb_build_object('release_result', v_release_result);

        -- Log the compensation action
        INSERT INTO public.credit_monitoring_events (
          user_id, request_id, feature, event_type, details
        ) VALUES (
          v_record.user_id,
          v_record.request_id,
          v_record.feature,
          'compensation_release',
          details
        );
      END IF;

      RETURN NEXT;

    ELSIF v_record.reservation_status = 'committed' THEN
      -- Case: Credits were committed but generation actually failed
      -- This is more serious - we need to refund the consumed credits
      
      -- First check if already refunded
      SELECT COUNT(*) INTO v_usage_count
      FROM public.credit_transactions ct
      WHERE ct.user_id = v_record.user_id
        AND ct.request_id = v_record.request_id
        AND ct.transaction_type = 'refund';

      IF v_usage_count > 0 THEN
        -- Already refunded
        action_taken := 'already_refunded';
        details := jsonb_build_object(
          'error_stage', v_record.error_stage,
          'error_message', v_record.error_message,
          'compensation_type', 'none_needed'
        );
        RETURN NEXT;
        CONTINUE;
      END IF;

      action_taken := CASE WHEN p_dry_run THEN 'would_refund' ELSE 'refunded' END;
      details := jsonb_build_object(
        'error_stage', v_record.error_stage,
        'error_message', v_record.error_message,
        'committed_amount', v_record.reserved_amount,
        'compensation_type', 'refund_committed_credits'
      );

      IF NOT p_dry_run THEN
        v_refund_result := public.refund_consumed_credits(
          v_record.user_id,
          v_record.request_id,
          'Compensation: Committed credits for failed generation',
          jsonb_build_object(
            'compensation_source', 'detect_and_compensate_failed_generations',
            'original_error_stage', v_record.error_stage,
            'original_error_message', v_record.error_message,
            'compensation_timestamp', now()
          )
        );

        details := details || jsonb_build_object('refund_result', v_refund_result);

        -- Log the compensation action
        INSERT INTO public.credit_monitoring_events (
          user_id, request_id, feature, event_type, details
        ) VALUES (
          v_record.user_id,
          v_record.request_id,
          v_record.feature,
          'compensation_refund',
          details
        );
      END IF;

      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

-- Grant execution to service_role for automated compensation jobs
REVOKE ALL ON FUNCTION public.detect_and_compensate_failed_generations(UUID, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_and_compensate_failed_generations(UUID, INTEGER, BOOLEAN) TO service_role;

-- Create a view for easy monitoring of credit issues
CREATE OR REPLACE VIEW public.credit_issues_summary AS
SELECT 
  iga.user_id,
  iga.feature,
  cr.status AS reservation_status,
  COUNT(*) AS issue_count,
  SUM(cr.amount) AS total_credits_affected,
  MIN(iga.created_at) AS oldest_issue,
  MAX(iga.created_at) AS newest_issue
FROM public.image_generation_attempts iga
JOIN public.credit_reservations cr 
  ON cr.request_id = iga.request_id AND cr.user_id = iga.user_id
WHERE 
  iga.status = 'failed'
  AND iga.created_at >= now() - INTERVAL '24 hours'
  AND (
    cr.status = 'reserved'
    OR cr.status = 'committed'
  )
GROUP BY iga.user_id, iga.feature, cr.status
ORDER BY issue_count DESC;

-- Allow authenticated users to see their own credit issues via RLS
-- (View itself doesn't support RLS, so we query directly in the application)

COMMENT ON FUNCTION public.detect_and_compensate_failed_generations(UUID, INTEGER, BOOLEAN) IS 
'Detects and compensates for credit deductions on failed image generations. Use dry_run=true to preview actions without making changes.';

COMMENT ON VIEW public.credit_issues_summary IS 
'Summary of potential credit issues from failed image generations in the last 24 hours.';
