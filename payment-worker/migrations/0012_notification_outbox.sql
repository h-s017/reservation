-- Admin-only notification outbox. Triggered inside the same transaction as a booking state change.
-- Sending is a separate retryable operation; never delay or roll back a confirmed payment.
CREATE TABLE notification_outbox (
 event_key TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('line','email')),
 order_id TEXT NOT NULL REFERENCES orders(id),
 kind TEXT NOT NULL CHECK(kind IN ('PAID','LINE_INQUIRY','PAYMENT_FAILED','REFUND_REQUESTED','REFUNDED')),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','RETRY','SENT','FAILED')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 next_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
 lease_until INTEGER NOT NULL DEFAULT 0,
 lease_id TEXT,
 retry_key TEXT,
 sent_at INTEGER,
 error_code TEXT,
 PRIMARY KEY (event_key,channel)
);
CREATE INDEX notification_due ON notification_outbox(status,next_attempt_at,lease_until);
CREATE TRIGGER notification_paid AFTER UPDATE OF status ON orders
WHEN NEW.status='PAID' AND OLD.status<>'PAID'
BEGIN
 INSERT OR IGNORE INTO notification_outbox(event_key,channel,order_id,kind)
 SELECT 'paid:'||NEW.id, 'line', NEW.id,'PAID'
 UNION ALL SELECT 'paid:'||NEW.id,'email',NEW.id,'PAID';
END;
-- A LINE inquiry is NOT a paid/confirmed booking; label it explicitly.
CREATE TRIGGER notification_line_inquiry AFTER INSERT ON orders
WHEN NEW.status='LINE_CONFIRMATION'
BEGIN
 INSERT OR IGNORE INTO notification_outbox(event_key,channel,order_id,kind)
 SELECT 'inquiry:'||NEW.id,'line',NEW.id,'LINE_INQUIRY'
 UNION ALL SELECT 'inquiry:'||NEW.id,'email',NEW.id,'LINE_INQUIRY';
END;
CREATE TRIGGER notification_payment_failed AFTER UPDATE OF status ON payment_attempts
WHEN OLD.status='PENDING' AND NEW.status='FAILED'
BEGIN
 INSERT OR IGNORE INTO notification_outbox(event_key,channel,order_id,kind)
 SELECT 'failed:'||NEW.id,'line',NEW.order_id,'PAYMENT_FAILED'
 UNION ALL SELECT 'failed:'||NEW.id,'email',NEW.order_id,'PAYMENT_FAILED';
END;
CREATE TRIGGER notification_refund AFTER UPDATE OF cancellation_status ON orders
WHEN NEW.cancellation_status<>OLD.cancellation_status AND NEW.cancellation_status IN ('REFUND_PENDING','REFUNDED')
BEGIN
 INSERT OR IGNORE INTO notification_outbox(event_key,channel,order_id,kind)
 SELECT 'refund:'||NEW.cancellation_status||':'||NEW.id,'line',NEW.id,
 CASE WHEN NEW.cancellation_status='REFUNDED' THEN 'REFUNDED' ELSE 'REFUND_REQUESTED' END
 UNION ALL SELECT 'refund:'||NEW.cancellation_status||':'||NEW.id,'email',NEW.id,
 CASE WHEN NEW.cancellation_status='REFUNDED' THEN 'REFUNDED' ELSE 'REFUND_REQUESTED' END;
END;
