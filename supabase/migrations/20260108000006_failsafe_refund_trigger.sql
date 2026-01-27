-- Failsafe Trigger: Automatically refund credits when a scene is marked as error.
-- This acts as a backup if the edge function fails to trigger the refund or update the attempt status.

CREATE OR REPLACE FUNCTION public.handle_scene_error_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  -- Only trigger if generation_status transitions to 'error'
  IF NEW.generation_status = 'error' AND (OLD.generation_status IS NULL OR OLD.generation_status <> 'error') THEN
    
    RAISE NOTICE 'Failsafe: Scene % marked as error. Checking for refundable credits...', NEW.id;

    -- 1. Try to find the request_id from credit_transactions (Usage)
    SELECT request_id, user_id INTO v_request_id, v_user_id
    FROM public.credit_transactions
    WHERE (metadata ->> 'scene_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (metadata ->> 'scene_id')::uuid = NEW.id
      AND transaction_type = 'usage'
    ORDER BY created_at DESC
    LIMIT 1;

    -- 2. If not found, try credit_reservations
    IF v_request_id IS NULL THEN
      SELECT request_id, user_id INTO v_request_id, v_user_id
      FROM public.credit_reservations
      WHERE (metadata ->> 'scene_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (metadata ->> 'scene_id')::uuid = NEW.id
        AND status IN ('reserved', 'committed')
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    -- 3. If request_id found, attempt refund
    IF v_request_id IS NOT NULL AND v_user_id IS NOT NULL THEN
      RAISE NOTICE 'Failsafe: Found request_id % for scene %. Attempting refund.', v_request_id, NEW.id;
      
      -- Call the robust refund function
      v_result := public.force_refund_credits(
        v_user_id,
        v_request_id,
        'Failsafe: Scene generation marked as error',
        jsonb_build_object('source', 'failsafe_trigger', 'scene_id', NEW.id)
      );
      
      RAISE NOTICE 'Failsafe: Refund result: %', v_result;
    ELSE
      RAISE NOTICE 'Failsafe: No credit transaction or reservation found for scene %', NEW.id;
    END IF;

  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_scene_error_refund ON public.scenes;

CREATE TRIGGER on_scene_error_refund
  AFTER UPDATE OF generation_status ON public.scenes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_scene_error_refund();
