-- SQLite requires a table rebuild to extend the mode CHECK constraint.
-- This migration preserves every attempt and its unique provider references.
CREATE TABLE event_payment_attempts_with_live (
  order_id TEXT PRIMARY KEY REFERENCES event_orders(id),
  mode TEXT NOT NULL CHECK(mode IN ('test','mock','live')),
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('CREATING','READY','PAID','FAILED','EXPIRED','REVIEW','REFUNDED')),
  session_id TEXT UNIQUE, checkout_url TEXT, expires_at INTEGER, payment_reference TEXT UNIQUE,
  provider_order_id TEXT UNIQUE, updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO event_payment_attempts_with_live (
  order_id,mode,plan_id,status,session_id,checkout_url,expires_at,payment_reference,provider_order_id,updated_at
)
SELECT order_id,mode,plan_id,status,session_id,checkout_url,expires_at,payment_reference,provider_order_id,updated_at
FROM event_payment_attempts;
DROP TABLE event_payment_attempts;
ALTER TABLE event_payment_attempts_with_live RENAME TO event_payment_attempts;
CREATE INDEX event_payment_reconcile ON event_payment_attempts(status,expires_at);
