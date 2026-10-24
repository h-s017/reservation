-- Source-specific reconciliation never touches orders, payment state, or manually closed slots.
ALTER TABLE busy_intervals ADD COLUMN last_seen_sync TEXT;
CREATE TABLE calendar_sync_state (
 id TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN ('OK','ERROR')),
 last_attempt_at INTEGER NOT NULL,
 last_success_at INTEGER,
 event_count INTEGER NOT NULL DEFAULT 0,
 error_code TEXT
);
