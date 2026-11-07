-- Cancel the reservation independently of unresolved payments or refunds.
-- Never rewrite a provider result or mark a refund as completed.
ALTER TABLE orders ADD COLUMN booking_cancelled_at INTEGER;
ALTER TABLE orders ADD COLUMN booking_cancel_reason TEXT;
CREATE TRIGGER cancel_reservation AFTER UPDATE OF booking_cancelled_at ON orders
WHEN OLD.booking_cancelled_at IS NULL AND NEW.booking_cancelled_at IS NOT NULL BEGIN
 UPDATE order_slots SET active=0 WHERE order_id=NEW.id AND active=1;
 INSERT INTO admin_audit(action,target,created_at) VALUES('CANCEL_RESERVATION',NEW.id,unixepoch());
 UPDATE orders SET cancellation_status='REFUND_PENDING',cancellation_reason=NEW.booking_cancel_reason,refund_requested_at=unixepoch()
 WHERE id=NEW.id AND status='PAID' AND cancellation_status='NONE';
END;
CREATE TRIGGER cancelled_reservation_attempt BEFORE INSERT ON payment_attempts
WHEN EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND booking_cancelled_at IS NOT NULL) BEGIN
 SELECT RAISE(ABORT,'COURSE_UNAVAILABLE');
END;
CREATE TRIGGER cancelled_reservation_seat BEFORE INSERT ON order_slots
WHEN NEW.active=1 AND EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND booking_cancelled_at IS NOT NULL) BEGIN
 SELECT RAISE(ABORT,'COURSE_UNAVAILABLE');
END;
CREATE TRIGGER cancelled_reservation_reopen BEFORE UPDATE OF active ON order_slots
WHEN NEW.active=1 AND OLD.active=0 AND EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND booking_cancelled_at IS NOT NULL) BEGIN
 SELECT RAISE(ABORT,'COURSE_UNAVAILABLE');
END;
CREATE TRIGGER cancelled_reservation_late_payment AFTER UPDATE OF status ON orders
WHEN NEW.status='PAID' AND NEW.booking_cancelled_at IS NOT NULL AND NEW.cancellation_status='NONE' BEGIN
 UPDATE orders SET cancellation_status='REFUND_PENDING',cancellation_reason='取消預約後入帳，待核對退款',refund_requested_at=unixepoch() WHERE id=NEW.id;
END;
