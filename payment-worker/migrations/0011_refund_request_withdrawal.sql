-- A pending refund request can be withdrawn without recording a completed refund.
-- Keep the original payment and the independent booking cancellation unchanged.
DROP TRIGGER cancellation_guard;
CREATE TRIGGER cancellation_guard BEFORE UPDATE OF cancellation_status ON orders
WHEN NEW.cancellation_status<>OLD.cancellation_status BEGIN
 SELECT RAISE(ABORT,'REFUND_STATE_CONFLICT') WHERE OLD.status<>'PAID' OR NOT (
  (OLD.cancellation_status='NONE' AND NEW.cancellation_status='REFUND_PENDING' AND length(NEW.cancellation_reason)>0)
  OR (OLD.cancellation_status='REFUND_PENDING' AND NEW.cancellation_status='REFUNDED' AND length(NEW.refund_reference)>0)
  OR (OLD.cancellation_status='REFUND_PENDING' AND NEW.cancellation_status='NONE'
   AND NEW.status=OLD.status AND OLD.refund_reference IS NULL AND NEW.refund_reference IS NULL
   AND OLD.refunded_at IS NULL AND NEW.refunded_at IS NULL
   AND length(trim(NEW.cancellation_reason))>0 AND NEW.cancellation_reason IS NOT OLD.cancellation_reason));
END;
