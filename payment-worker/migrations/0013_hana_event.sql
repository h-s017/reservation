-- Add event-specific records to the existing HANA Reservation D1 database.
PRAGMA foreign_keys=ON;
CREATE TABLE event_catalogue (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, english_title TEXT NOT NULL,
  poster_url TEXT NOT NULL DEFAULT '', starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1))
);
CREATE TABLE event_partners (
  event_slug TEXT NOT NULL REFERENCES event_catalogue(slug), code TEXT NOT NULL,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', logo_url TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(event_slug,code)
);
CREATE TABLE event_tickets (
  event_slug TEXT NOT NULL REFERENCES event_catalogue(slug), id TEXT NOT NULL,
  plan TEXT NOT NULL, type TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0),
  PRIMARY KEY(event_slug,id)
);
CREATE TABLE event_slots (
  event_slug TEXT NOT NULL REFERENCES event_catalogue(slug), id TEXT NOT NULL,
  date TEXT NOT NULL, time TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  team_mask INTEGER NOT NULL CHECK(team_mask BETWEEN 0 AND 7), possible TEXT NOT NULL CHECK(json_valid(possible)),
  available TEXT NOT NULL CHECK(json_valid(available)), mixes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(mixes)),
  capacity INTEGER NOT NULL DEFAULT 0 CHECK(capacity>=0), status TEXT NOT NULL DEFAULT 'interest' CHECK(status IN ('interest','open','closed')),
  PRIMARY KEY(event_slug,id), UNIQUE(event_slug,date,time), CHECK(ends_at>starts_at),
  CHECK(status<>'open' OR (capacity>0 AND json_array_length(mixes)>0))
);
CREATE TABLE event_orders (
  id TEXT PRIMARY KEY, event_slug TEXT NOT NULL, slot_id TEXT NOT NULL, access_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, email TEXT NOT NULL, mix TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20), amount INTEGER NOT NULL CHECK(amount>0),
  status TEXT NOT NULL CHECK(status IN ('INTEREST','WAITING_PAYMENT','PROCESSING','PAID','CONFIRMED','CANCELLED','FAILED','REFUND_PENDING','REFUNDED')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), hold_until INTEGER NOT NULL, paid_at INTEGER, refunded_at INTEGER,
  FOREIGN KEY(event_slug,slot_id) REFERENCES event_slots(event_slug,id)
);
CREATE INDEX event_orders_by_slot ON event_orders(event_slug,slot_id,status,hold_until);
CREATE TABLE event_order_items (
  order_id TEXT NOT NULL REFERENCES event_orders(id), ticket_id TEXT NOT NULL, plan TEXT NOT NULL,
  label TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price INTEGER NOT NULL CHECK(unit_price>0),
  PRIMARY KEY(order_id,ticket_id)
);
CREATE TABLE event_payment_attempts (
  order_id TEXT PRIMARY KEY REFERENCES event_orders(id), mode TEXT NOT NULL CHECK(mode IN ('test','mock')),
  plan_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('CREATING','READY','PAID','FAILED','EXPIRED','REVIEW','REFUNDED')),
  session_id TEXT UNIQUE, checkout_url TEXT, expires_at INTEGER, payment_reference TEXT UNIQUE, provider_order_id TEXT UNIQUE,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX event_payment_reconcile ON event_payment_attempts(status,expires_at);
CREATE TABLE event_webhook_events (
  mode TEXT NOT NULL, event TEXT NOT NULL, provider_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES event_orders(id), received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(mode,event,provider_id)
);
CREATE TABLE event_order_actions (
  id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES event_orders(id), action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '', reference TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TRIGGER event_order_reserve BEFORE INSERT ON event_orders BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM event_slots s JOIN event_catalogue e ON e.slug=s.event_slug
    WHERE s.event_slug=NEW.event_slug AND s.id=NEW.slot_id AND e.published=1 AND s.starts_at>unixepoch()
      AND ((NEW.status='INTEREST' AND s.status='interest')
        OR (NEW.status='WAITING_PAYMENT' AND s.status='open' AND NEW.mix IN (SELECT value FROM json_each(s.mixes))))
  ) THEN RAISE(ABORT,'UNAVAILABLE') END;
  SELECT CASE WHEN NEW.status='WAITING_PAYMENT' AND NEW.quantity + COALESCE((
    SELECT SUM(quantity) FROM event_orders AS o WHERE o.event_slug=NEW.event_slug AND o.slot_id=NEW.slot_id
      AND (o.status IN ('PROCESSING','PAID','CONFIRMED','REFUND_PENDING') OR (o.status='WAITING_PAYMENT' AND o.hold_until>unixepoch()))
  ),0) > (SELECT capacity FROM event_slots WHERE event_slug=NEW.event_slug AND id=NEW.slot_id)
  THEN RAISE(ABORT,'SLOT_FULL') END;
END;
CREATE TRIGGER event_order_price_check BEFORE INSERT ON event_order_items BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM event_orders o JOIN event_tickets t ON t.event_slug=o.event_slug AND t.id=NEW.ticket_id
    WHERE o.id=NEW.order_id AND t.price=NEW.unit_price AND t.plan=NEW.plan AND t.type=NEW.label
  ) THEN RAISE(ABORT,'PRICE_CHANGED') END;
END;
CREATE TRIGGER event_order_promote BEFORE UPDATE OF status ON event_orders
WHEN OLD.status='INTEREST' AND NEW.status='WAITING_PAYMENT' BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM event_slots s JOIN event_catalogue e ON e.slug=s.event_slug
    WHERE s.event_slug=NEW.event_slug AND s.id=NEW.slot_id AND e.published=1 AND s.starts_at>unixepoch()
      AND s.status='open' AND NEW.mix IN (SELECT value FROM json_each(s.mixes))
  ) THEN RAISE(ABORT,'UNAVAILABLE') END;
  SELECT CASE WHEN NEW.quantity + COALESCE((
    SELECT SUM(quantity) FROM event_orders o WHERE o.event_slug=NEW.event_slug AND o.slot_id=NEW.slot_id
      AND (o.status IN ('PROCESSING','PAID','CONFIRMED','REFUND_PENDING') OR (o.status='WAITING_PAYMENT' AND o.hold_until>unixepoch()))
  ),0) > (SELECT capacity FROM event_slots WHERE event_slug=NEW.event_slug AND id=NEW.slot_id)
  THEN RAISE(ABORT,'SLOT_FULL') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM event_order_items i JOIN event_tickets t ON t.event_slug=NEW.event_slug AND t.id=i.ticket_id
    WHERE i.order_id=NEW.id AND t.price<>i.unit_price
  ) THEN RAISE(ABORT,'PRICE_CHANGED') END;
END;
CREATE TRIGGER event_slot_update BEFORE UPDATE ON event_slots BEGIN
  SELECT CASE WHEN NEW.capacity < COALESCE((
    SELECT SUM(quantity) FROM event_orders o WHERE o.event_slug=NEW.event_slug AND o.slot_id=NEW.id
      AND (o.status IN ('PROCESSING','PAID','CONFIRMED','REFUND_PENDING') OR (o.status='WAITING_PAYMENT' AND o.hold_until>unixepoch()))
  ),0) THEN RAISE(ABORT,'CAPACITY_CONFLICT') END;
  SELECT CASE WHEN NEW.status='open' AND EXISTS (
    SELECT 1 FROM event_slots other WHERE other.event_slug=NEW.event_slug AND other.id<>NEW.id
      AND other.starts_at<NEW.ends_at AND other.ends_at>NEW.starts_at AND (other.status='open' OR EXISTS (
        SELECT 1 FROM event_orders o WHERE o.event_slug=other.event_slug AND o.slot_id=other.id
          AND (o.status IN ('PROCESSING','PAID','CONFIRMED','REFUND_PENDING') OR (o.status='WAITING_PAYMENT' AND o.hold_until>unixepoch()))
      ))
  ) THEN RAISE(ABORT,'TIME_CONFLICT') END;
END;
CREATE TRIGGER event_no_direct_open_slot BEFORE INSERT ON event_slots WHEN NEW.status='open' BEGIN
  SELECT RAISE(ABORT,'CONFIRM_SLOT_AFTER_CREATION');
END;
