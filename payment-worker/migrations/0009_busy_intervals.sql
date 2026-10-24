-- Reservation Manager V1: busy periods are independent overlays.
-- Never rewrite slots.status, bookings, payment outcomes or manual closed dates.
CREATE TABLE busy_intervals (
 id TEXT PRIMARY KEY,
 source TEXT NOT NULL DEFAULT 'workspace' CHECK(source IN ('workspace','google')),
 title TEXT NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 updated_at INTEGER NOT NULL,
 CHECK(ends_at>starts_at)
);
CREATE INDEX busy_intervals_range ON busy_intervals(active,starts_at,ends_at);
-- Existing slot times are "HH:MM–HH:MM" in Asia/Taipei. For other formats,
-- reject the deployment until normalization is implemented.
CREATE TRIGGER busy_guard_insert BEFORE INSERT ON order_slots WHEN NEW.active=1 BEGIN
 SELECT RAISE(ABORT,'BUSY_CONFLICT') WHERE EXISTS(
 SELECT 1 FROM slots s JOIN busy_intervals b ON b.active=1
 WHERE s.id=NEW.slot_id AND b.starts_at < s.starts_at+
  ((CAST(substr(s.time,7,2) AS INTEGER)*60+CAST(substr(s.time,10,2) AS INTEGER)
   -CAST(substr(s.time,1,2) AS INTEGER)*60-CAST(substr(s.time,4,2) AS INTEGER))*60)
 AND b.ends_at>s.starts_at);
END;
CREATE TRIGGER busy_guard_reopen BEFORE UPDATE OF active ON order_slots WHEN OLD.active=0 AND NEW.active=1 BEGIN
 SELECT RAISE(ABORT,'BUSY_CONFLICT') WHERE EXISTS(
 SELECT 1 FROM slots s JOIN busy_intervals b ON b.active=1
 WHERE s.id=NEW.slot_id AND b.starts_at < s.starts_at+
  ((CAST(substr(s.time,7,2) AS INTEGER)*60+CAST(substr(s.time,10,2) AS INTEGER)
   -CAST(substr(s.time,1,2) AS INTEGER)*60-CAST(substr(s.time,4,2) AS INTEGER))*60)
 AND b.ends_at>s.starts_at);
END;
-- A pending reservation may exist when an appointment is created.
-- Do not cancel its order; pause checkout and surface a conflict for human review.
CREATE TRIGGER busy_guard_payment BEFORE INSERT ON payment_attempts BEGIN
 SELECT RAISE(ABORT,'BUSY_CONFLICT') WHERE EXISTS(
 SELECT 1 FROM order_slots os JOIN slots s ON s.id=os.slot_id
 JOIN busy_intervals b ON b.active=1
 WHERE os.order_id=NEW.order_id AND os.active=1
 AND b.starts_at < s.starts_at+
  ((CAST(substr(s.time,7,2) AS INTEGER)*60+CAST(substr(s.time,10,2) AS INTEGER)
   -CAST(substr(s.time,1,2) AS INTEGER)*60-CAST(substr(s.time,4,2) AS INTEGER))*60)
 AND b.ends_at>s.starts_at);
END;
