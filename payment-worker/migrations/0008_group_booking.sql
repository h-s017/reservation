-- Existing orders remain one booking unit; a double course unit is one pair.
ALTER TABLE orders ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 100);
ALTER TABLE orders ADD COLUMN unit_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN booking_unit TEXT NOT NULL DEFAULT '位';
UPDATE orders SET unit_price=amount,booking_unit=COALESCE((SELECT unit FROM courses WHERE id=orders.course_id),'位');
CREATE TRIGGER protect_order_quantity BEFORE UPDATE OF quantity ON orders WHEN NEW.quantity<>OLD.quantity BEGIN
 SELECT RAISE(ABORT,'QUANTITY_IMMUTABLE');
END;
DROP TRIGGER reserve_seat;
DROP TRIGGER count_seat;
DROP TRIGGER reacquire_seat;
DROP TRIGGER change_seat;
CREATE TRIGGER reserve_seat BEFORE INSERT ON order_slots WHEN NEW.active=1 BEGIN
 SELECT RAISE(ABORT,'SLOT_FULL') WHERE NOT EXISTS(SELECT 1 FROM slots s JOIN courses c ON c.id=s.course_id JOIN orders o ON o.id=NEW.order_id
 WHERE s.id=NEW.slot_id AND s.status='OPEN' AND c.enabled=1 AND s.booked+o.quantity<=s.capacity
 AND s.starts_at>=unixepoch()+129600 AND NOT EXISTS(SELECT 1 FROM closed_dates WHERE date=s.date));
END;
CREATE TRIGGER count_seat AFTER INSERT ON order_slots WHEN NEW.active=1 BEGIN
 UPDATE slots SET booked=booked+(SELECT quantity FROM orders WHERE id=NEW.order_id) WHERE id=NEW.slot_id;
END;
CREATE TRIGGER reacquire_seat BEFORE UPDATE OF active ON order_slots WHEN OLD.active=0 AND NEW.active=1 BEGIN
 SELECT RAISE(ABORT,'SLOT_FULL') WHERE NOT EXISTS(SELECT 1 FROM slots s JOIN courses c ON c.id=s.course_id JOIN orders o ON o.id=NEW.order_id
 WHERE s.id=NEW.slot_id AND s.status='OPEN' AND c.enabled=1 AND s.booked+o.quantity<=s.capacity
 AND s.starts_at>=unixepoch()+129600 AND NOT EXISTS(SELECT 1 FROM closed_dates WHERE date=s.date));
END;
CREATE TRIGGER change_seat AFTER UPDATE OF active ON order_slots WHEN OLD.active<>NEW.active BEGIN
 UPDATE slots SET booked=booked+(NEW.active-OLD.active)*(SELECT quantity FROM orders WHERE id=NEW.order_id) WHERE id=NEW.slot_id;
END;
