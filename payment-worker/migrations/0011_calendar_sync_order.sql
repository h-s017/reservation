-- Prevent a slower, older Calendar API response from reverting a newer completed sync.
ALTER TABLE calendar_sync_state ADD COLUMN fetch_started_ms INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER calendar_sync_reject_stale
BEFORE UPDATE OF fetch_started_ms ON calendar_sync_state
WHEN NEW.fetch_started_ms < OLD.fetch_started_ms
BEGIN
  SELECT RAISE(ABORT,'CALENDAR_STALE_SNAPSHOT');
END;
