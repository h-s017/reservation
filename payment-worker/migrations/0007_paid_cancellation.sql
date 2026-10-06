ALTER TABLE orders ADD COLUMN cancellation_status TEXT NOT NULL DEFAULT 'NONE' CHECK(cancellation_status IN ('NONE','REFUND_PENDING','REFUNDED'));
ALTER TABLE orders ADD COLUMN cancellation_reason TEXT;
ALTER TABLE orders ADD COLUMN refund_reference TEXT;
ALTER TABLE orders ADD COLUMN refund_requested_at INTEGER;
ALTER TABLE orders ADD COLUMN refunded_at INTEGER;
CREATE TRIGGER cancellation_guard BEFORE UPDATE OF cancellation_status ON orders
WHEN NEW.cancellation_status<>OLD.cancellation_status BEGIN
 SELECT RAISE(ABORT,'REFUND_STATE_CONFLICT') WHERE OLD.status<>'PAID' OR NOT (
  (OLD.cancellation_status='NONE' AND NEW.cancellation_status='REFUND_PENDING' AND length(NEW.cancellation_reason)>0)
  OR (OLD.cancellation_status='REFUND_PENDING' AND NEW.cancellation_status='REFUNDED' AND length(NEW.refund_reference)>0));
END;
CREATE TRIGGER cancellation_audit AFTER UPDATE OF cancellation_status ON orders
WHEN NEW.cancellation_status<>OLD.cancellation_status BEGIN
 INSERT INTO admin_audit(action,target,created_at) VALUES('CANCELLATION_'||NEW.cancellation_status,NEW.id,unixepoch());
 UPDATE order_slots SET active=0 WHERE order_id=NEW.id AND NEW.cancellation_status='REFUNDED' AND active=1;
END;
