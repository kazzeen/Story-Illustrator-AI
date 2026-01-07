-- Emergency Trigger: Automatically refund credits when an attempt is marked as failed.
-- This bypasses any client-side refund logic issues by reacting directly to the status change in the database.

CREATE OR REPLACE FUNCTION public.handle_failed_attempt_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Only trigger if status transitions to 'failed'
  IF NEW.status = 'failed' AND (OLD.status IS NULL OR OLD.status <> 'failed') THEN
    
    -- Log intent
    RAISE NOTICE 'Triggering refund for failed attempt %', NEW.request_id;

    -- Call the robust refund function
    v_result := public.refund_consumed_credits(
      NEW.user_id,
      NEW.request_id,
      'Automatic refund: ' || COALESCE(NEW.error_message, 'Generation marked as failed')
    );
    
    -- We can log v_result into metadata if we want, but keeping it simple is safer
    -- Update the attempt to record that we tried refunding
    -- (recursion safety: we are in AFTER trigger, updating NEW is not possible, updating table? loop risk?)
    -- Better to just do the refund. refund_consumed_credits handles idempotency.

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_attempt_failed_refund ON public.image_generation_attempts;

CREATE TRIGGER on_attempt_failed_refund
  AFTER UPDATE OF status ON public.image_generation_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_failed_attempt_refund();
