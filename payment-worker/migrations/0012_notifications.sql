-- Reliable transactional notification outbox, sourced exclusively from committed D1 state changes.
-- No LINE recipient, Email recipient, provider token, or student contact PII is stored here.
CREATE TABLE notification_events (
 event_key TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('BOOKING_NEW','PAYMENT_PAID','BOOKING_CANCELLED','REFUND_REQUESTED','REFUND_COMPLETED','PAYMENT_FAILED','ANOMALY')),
 order_id TEXT,
 detail TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE notification_deliveries (
 event_key TEXT NOT NULL REFERENCES notification_events(event_key),
 channel TEXT NOT NULL CHECK(channel IN ('line','email')),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','RETRY','SENT','FAILED','REVIEW')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 first_attempt_at INTEGER,
 claimed_at INTEGER,
 lease_until INTEGER,
 claim_id TEXT,
 provider_id TEXT,
 last_error TEXT,
 sent_at INTEGER,
 PRIMARY KEY(event_key,channel)
);
CREATE INDEX notification_due ON notification_deliveries(status,next_attempt_at,lease_until);
CREATE TRIGGER notification_fanout AFTER INSERT ON notification_events BEGIN
 INSERT INTO notification_deliveries(event_key,channel) VALUES(NEW.event_key,'line'),(NEW.event_key,'email');
END;
CREATE TRIGGER notify_booking_created AFTER INSERT ON orders BEGIN
 INSERT OR IGNORE INTO notification_events(event_key,kind,order_id,detail)
 VALUES('order:'||NEW.id||':new','BOOKING_NEW',NEW.id,'');
END;
CREATE TRIGGER notify_order_state AFTER UPDATE OF status ON orders WHEN OLD.status<>NEW.status AND NEW.status IN ('PAID','CANCELLED') BEGIN
 INSERT OR IGNORE INTO notification_events(event_key,kind,order_id,detail)
 VALUES('order:'||NEW.id||CASE NEW.status WHEN 'PAID' THEN ':paid' ELSE ':cancelled' END,
 CASE NEW.status WHEN 'PAID' THEN 'PAYMENT_PAID' ELSE 'BOOKING_CANCELLED' END,NEW.id,'');
END;
CREATE TRIGGER notify_refund_state AFTER UPDATE OF cancellation_status ON orders
WHEN OLD.cancellation_status<>NEW.cancellation_status AND NEW.cancellation_status IN ('REFUND_PENDING','REFUNDED') BEGIN
 INSERT OR IGNORE INTO notification_events(event_key,kind,order_id,detail)
 VALUES('order:'||NEW.id||':refund:'||NEW.cancellation_status,
 CASE NEW.cancellation_status WHEN 'REFUND_PENDING' THEN 'REFUND_REQUESTED' ELSE 'REFUND_COMPLETED' END, NEW.id,'');
END;
CREATE TRIGGER notify_failed_attempt AFTER UPDATE OF status ON payment_attempts
WHEN OLD.status<>NEW.status AND NEW.status='FAILED' BEGIN
 INSERT OR IGNORE INTO notification_events(event_key,kind,order_id,detail)
 VALUES('attempt:'||NEW.id||':failed','PAYMENT_FAILED',NEW.order_id,'');
END;
-- Sanitized internal errors only; dedupe same diagnostic code per hour to avoid floods.
CREATE TRIGGER notify_admin_anomaly AFTER INSERT ON admin_audit
WHEN NEW.action IN ('NOTIFY_REJECTED','ATM_QUERY_FAILED') BEGIN
 INSERT OR IGNORE INTO notification_events(event_key,kind,order_id,detail)
 SELECT 'audit:'||NEW.id,'ANOMALY',NULL,substr(NEW.action||':'||NEW.target,1,180)
 WHERE NOT EXISTS (
 SELECT 1 FROM notification_events
 WHERE kind='ANOMALY' AND detail=substr(NEW.action||':'||NEW.target,1,180)
 AND created_at>unixepoch()-3600
 );
END;
