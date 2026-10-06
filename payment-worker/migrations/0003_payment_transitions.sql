CREATE TRIGGER payment_success BEFORE UPDATE OF status ON payment_attempts WHEN NEW.status='PAID' AND OLD.status<>'PAID' BEGIN
  SELECT RAISE(ABORT,'PAYMENT_PENDING') WHERE OLD.status<>'PENDING' OR NEW.trade_no IS NULL OR NOT EXISTS(
    SELECT 1 FROM orders WHERE id=NEW.order_id AND status='PENDING');
END;
CREATE TRIGGER payment_success_order AFTER UPDATE OF status ON payment_attempts WHEN NEW.status='PAID' AND OLD.status<>'PAID' BEGIN
  UPDATE orders SET status='PAID',trade_no=NEW.trade_no,paid_at=unixepoch() WHERE id=NEW.order_id;
END;
CREATE TRIGGER payment_failed_order AFTER UPDATE OF status ON payment_attempts WHEN NEW.status='FAILED' AND OLD.status='PENDING' BEGIN
  UPDATE orders SET status='FAILED',hold_until=unixepoch()+1800 WHERE id=NEW.order_id AND status='PENDING'
    AND NEW.ordinal=(SELECT MAX(ordinal) FROM payment_attempts WHERE order_id=NEW.order_id);
END;
CREATE TRIGGER payment_final BEFORE UPDATE OF status ON payment_attempts WHEN OLD.status IN ('PAID','FAILED') AND NEW.status<>OLD.status BEGIN
  SELECT RAISE(ABORT,'ATTEMPT_FINAL');
END;
