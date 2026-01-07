-- Improve the credit release trigger to log errors instead of silently swallowing them
-- This helps diagnose why credits might not be properly released for failed generations

CREATE OR REPLACE FUNCTION public._release_reserved_credits_on_attempt_failed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_error_text TEXT;
  v_error_detail TEXT;
BEGIN
  -- Only process if status is 'failed' and we have user_id and request_id
  IF NEW.status != 'failed' OR NEW.user_id IS NULL OR NEW.request_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Attempt to release reserved credits
    v_result := public.release_reserved_credits(
      NEW.user_id,
      NEW.request_id,
      COALESCE(NEW.error_message, 'Generation failed'),
      jsonb_build_object(
        'feature', NEW.feature,
        'status', NEW.status,
        'error_stage', NEW.error_stage,
        'error_message', NEW.error_message,
        'trigger_source', 'release_reserved_credits_on_generation_failed'
      )
    );

    -- Log the release result for monitoring
    IF v_result IS NOT NULL THEN
      IF (v_result->>'ok')::boolean = true THEN
        -- Log successful release
        INSERT INTO public.credit_monitoring_events (
          user_id,
          request_id,
          feature,
          event_type,
          details,
          created_at
        ) VALUES (
          NEW.user_id,
          NEW.request_id,
          NEW.feature,
          'credit_release_trigger_success',
          jsonb_build_object(
            'result', v_result,
            'error_stage', NEW.error_stage,
            'triggered_at', now()
          ),
          now()
        );
      ELSIF (v_result->>'already_released')::boolean = true THEN
        -- Credits were already released (idempotent - no action needed)
        NULL;
      ELSE
        -- Log failed release (e.g., missing reservation)
        INSERT INTO public.credit_monitoring_events (
          user_id,
          request_id,
          feature,
          event_type,
          details,
          created_at
        ) VALUES (
          NEW.user_id,
          NEW.request_id,
          NEW.feature,
          'credit_release_trigger_failed',
          jsonb_build_object(
            'result', v_result,
            'reason', v_result->>'reason',
            'error_stage', NEW.error_stage,
            'triggered_at', now()
          ),
          now()
        );
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Log the error instead of silently ignoring it
    GET STACKED DIAGNOSTICS 
      v_error_text = MESSAGE_TEXT,
      v_error_detail = PG_EXCEPTION_DETAIL;
    
    INSERT INTO public.credit_monitoring_events (
      user_id,
      request_id,
      feature,
      event_type,
      details,
      created_at
    ) VALUES (
      NEW.user_id,
      NEW.request_id,
      NEW.feature,
      'credit_release_trigger_exception',
      jsonb_build_object(
        'error_message', v_error_text,
        'error_detail', v_error_detail,
        'error_stage', NEW.error_stage,
        'original_error', NEW.error_message,
        'triggered_at', now()
      ),
      now()
    );
    
    -- Still don't rethrow to avoid blocking the trigger operation
    -- but we now have a record of the failure
  END;

  RETURN NEW;
END;
$$;

-- Ensure proper permissions
REVOKE ALL ON FUNCTION public._release_reserved_credits_on_attempt_failed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._release_reserved_credits_on_attempt_failed() TO service_role;

-- Recreate the trigger to ensure it uses the updated function
DROP TRIGGER IF EXISTS release_reserved_credits_on_generation_failed ON public.image_generation_attempts;

CREATE TRIGGER release_reserved_credits_on_generation_failed
AFTER INSERT OR UPDATE OF status ON public.image_generation_attempts
FOR EACH ROW
WHEN (NEW.status = 'failed')
EXECUTE FUNCTION public._release_reserved_credits_on_attempt_failed();

-- Add comment for documentation
COMMENT ON FUNCTION public._release_reserved_credits_on_attempt_failed() IS 
'Trigger function to automatically release reserved credits when an image generation attempt fails. Logs all actions to credit_monitoring_events for auditing and debugging.';
