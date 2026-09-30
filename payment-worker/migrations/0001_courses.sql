PRAGMA foreign_keys = ON;
CREATE TABLE courses (
  id TEXT PRIMARY KEY, series TEXT NOT NULL, course TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK(price>=0), capacity INTEGER NOT NULL CHECK(capacity>0),
  unit TEXT NOT NULL, mode TEXT NOT NULL, required_slots INTEGER NOT NULL, max_slots INTEGER NOT NULL,
  contest INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE slots (
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), date TEXT NOT NULL, time TEXT NOT NULL,
  starts_at INTEGER NOT NULL, capacity INTEGER NOT NULL CHECK(capacity>0), booked INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
  CHECK(booked>=0 AND booked<=capacity)
);
CREATE INDEX slots_date ON slots(date,course_id);
CREATE TABLE closed_dates (date TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '');
CREATE TABLE orders (
  id TEXT PRIMARY KEY, access_hash TEXT NOT NULL UNIQUE, course_id TEXT NOT NULL REFERENCES courses(id),
  course TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL CHECK(amount>=0),
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL, line TEXT NOT NULL, note TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','PAID','FAILED','CANCELLED','LINE_CONFIRMATION')),
  trade_no TEXT UNIQUE, created_at INTEGER NOT NULL, paid_at INTEGER, hold_until INTEGER NOT NULL
);
CREATE INDEX orders_created ON orders(created_at DESC,id);
CREATE TABLE order_slots (
  order_id TEXT NOT NULL REFERENCES orders(id), slot_id TEXT NOT NULL REFERENCES slots(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), PRIMARY KEY(order_id,slot_id)
);
CREATE INDEX order_slots_slot ON order_slots(slot_id,active);
CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), ordinal INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','PAID','FAILED')),
  timestamp INTEGER NOT NULL, trade_no TEXT UNIQUE, UNIQUE(order_id,ordinal)
);
CREATE UNIQUE INDEX one_pending_attempt ON payment_attempts(order_id) WHERE status='PENDING';
CREATE UNIQUE INDEX one_paid_attempt ON payment_attempts(order_id) WHERE status='PAID';
CREATE TABLE admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL);

-- Reserve/release seats inside the same SQLite transaction as order creation.
CREATE TRIGGER reserve_seat BEFORE INSERT ON order_slots WHEN NEW.active=1 BEGIN
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE NOT EXISTS(SELECT 1 FROM slots s JOIN courses c ON c.id=s.course_id
    WHERE s.id=NEW.slot_id AND s.status='OPEN' AND c.enabled=1 AND s.booked<s.capacity
    AND s.starts_at>=unixepoch()+129600 AND NOT EXISTS(SELECT 1 FROM closed_dates WHERE date=s.date));
END;
CREATE TRIGGER count_seat AFTER INSERT ON order_slots WHEN NEW.active=1 BEGIN
  UPDATE slots SET booked=booked+1 WHERE id=NEW.slot_id;
END;
CREATE TRIGGER reacquire_seat BEFORE UPDATE OF active ON order_slots WHEN OLD.active=0 AND NEW.active=1 BEGIN
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE NOT EXISTS(SELECT 1 FROM slots s JOIN courses c ON c.id=s.course_id
    WHERE s.id=NEW.slot_id AND s.status='OPEN' AND c.enabled=1 AND s.booked<s.capacity
    AND s.starts_at>=unixepoch()+129600 AND NOT EXISTS(SELECT 1 FROM closed_dates WHERE date=s.date));
END;
CREATE TRIGGER change_seat AFTER UPDATE OF active ON order_slots WHEN OLD.active<>NEW.active BEGIN
  UPDATE slots SET booked=booked+NEW.active-OLD.active WHERE id=NEW.slot_id;
END;
CREATE TRIGGER protect_paid BEFORE UPDATE OF status ON orders WHEN OLD.status='PAID' AND NEW.status<>'PAID' BEGIN
  SELECT RAISE(ABORT,'PAID_IMMUTABLE');
END;
CREATE TRIGGER protect_pending_cancel BEFORE UPDATE OF status ON orders
WHEN NEW.status='CANCELLED' AND EXISTS(SELECT 1 FROM payment_attempts WHERE order_id=OLD.id AND status='PENDING') BEGIN
  SELECT RAISE(ABORT,'PAYMENT_PENDING');
END;
CREATE TRIGGER cancel_seats AFTER UPDATE OF status ON orders WHEN NEW.status='CANCELLED' BEGIN
  UPDATE order_slots SET active=0 WHERE order_id=NEW.id;
END;
CREATE TRIGGER reopen_seats AFTER UPDATE OF status ON orders WHEN OLD.status='CANCELLED' AND NEW.status='PENDING' BEGIN
  UPDATE order_slots SET active=1 WHERE order_id=NEW.id;
END;
CREATE TRIGGER attempt_guard BEFORE INSERT ON payment_attempts BEGIN
  SELECT RAISE(ABORT,'COURSE_UNAVAILABLE') WHERE NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND status IN ('PENDING','FAILED') AND amount>0)
    OR EXISTS(SELECT 1 FROM order_slots os JOIN slots s ON s.id=os.slot_id WHERE os.order_id=NEW.order_id AND
      (os.active<>1 OR s.starts_at<unixepoch()+129600 OR s.status<>'OPEN' OR EXISTS(SELECT 1 FROM closed_dates WHERE date=s.date)));
END;
