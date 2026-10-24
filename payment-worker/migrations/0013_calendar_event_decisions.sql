-- Owner decisions on primary Google Calendar event instances.
-- Event keys are SHA-256-based IDs, never raw Google Calendar IDs or titles.
-- A choice only affects HANA's booking overlay, never modifies Google Calendar.
CREATE TABLE calendar_event_decisions (
 event_id TEXT PRIMARY KEY CHECK(length(event_id)=69 AND substr(event_id,1,5)='gcal-'),
 decision TEXT NOT NULL CHECK(decision IN ('BLOCK','IGNORE')),
 updated_at INTEGER NOT NULL
);
