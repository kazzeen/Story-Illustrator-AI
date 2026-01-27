CREATE OR REPLACE FUNCTION public._log_credit_transaction_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feature TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_feature := COALESCE(NEW.metadata ->> 'feature', NULL);
    INSERT INTO public.credit_monitoring_events (user_id, request_id, feature, event_type, details, created_at)
    VALUES (
      NEW.user_id,
      NEW.request_id,
      v_feature,
      'credit_transaction_created',
      jsonb_build_object(
        'transaction_id', NEW.id,
        'transaction_type', NEW.transaction_type,
        'amount', NEW.amount,
        'pool', NEW.pool,
        'description', NEW.description,
        'metadata', NEW.metadata
      ),
      now()
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD.transaction_type IS DISTINCT FROM NEW.transaction_type)
      OR (OLD.amount IS DISTINCT FROM NEW.amount)
      OR (OLD.description IS DISTINCT FROM NEW.description)
    THEN
      v_feature := COALESCE(NEW.metadata ->> 'feature', OLD.metadata ->> 'feature', NULL);
      INSERT INTO public.credit_monitoring_events (user_id, request_id, feature, event_type, details, created_at)
      VALUES (
        NEW.user_id,
        NEW.request_id,
        v_feature,
        'credit_transaction_updated',
        jsonb_build_object(
          'transaction_id', NEW.id,
          'old', jsonb_build_object(
            'transaction_type', OLD.transaction_type,
            'amount', OLD.amount,
            'description', OLD.description
          ),
          'new', jsonb_build_object(
            'transaction_type', NEW.transaction_type,
            'amount', NEW.amount,
            'description', NEW.description
          ),
          'pool', NEW.pool,
          'metadata', NEW.metadata
        ),
        now()
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_transactions_log_insert ON public.credit_transactions;
CREATE TRIGGER credit_transactions_log_insert
AFTER INSERT ON public.credit_transactions
FOR EACH ROW
EXECUTE FUNCTION public._log_credit_transaction_change();

DROP TRIGGER IF EXISTS credit_transactions_log_update ON public.credit_transactions;
CREATE TRIGGER credit_transactions_log_update
AFTER UPDATE ON public.credit_transactions
FOR EACH ROW
EXECUTE FUNCTION public._log_credit_transaction_change();

CREATE OR REPLACE FUNCTION public._log_credit_reservation_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new JSONB;
  v_old JSONB;
  v_user_id UUID;
  v_request_id UUID;
  v_feature TEXT;
BEGIN
  v_new := to_jsonb(NEW);
  v_old := to_jsonb(OLD);

  IF (v_old ->> 'status') IS DISTINCT FROM (v_new ->> 'status') THEN
    v_user_id := NULLIF(v_new ->> 'user_id', '')::uuid;
    v_request_id := NULLIF(v_new ->> 'request_id', '')::uuid;
    v_feature := COALESCE(v_new ->> 'feature', (v_new -> 'metadata') ->> 'feature', NULL);

    INSERT INTO public.credit_monitoring_events (user_id, request_id, feature, event_type, details, created_at)
    VALUES (
      v_user_id,
      v_request_id,
      v_feature,
      'credit_reservation_status_changed',
      jsonb_build_object(
        'old_status', v_old ->> 'status',
        'new_status', v_new ->> 'status',
        'reservation', v_new
      ),
      now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_reservations_log_status_update ON public.credit_reservations;
CREATE TRIGGER credit_reservations_log_status_update
AFTER UPDATE ON public.credit_reservations
FOR EACH ROW
EXECUTE FUNCTION public._log_credit_reservation_status_change();

