# HANA WORKSPACE｜Reservation Manager V1 (internal draft)
## Single backoffice
- HANA WORKSPACE (GitHub Pages) hosts the only operator screen at `/reservation-manager.html`.
- The existing `reservation.hanascent.com` remains the public student booking website.
- The production Cloudflare Worker/D1 stays the authority for orders, available slots, and payment state. Do not duplicate these in HANA FOCUS localStorage, Notion, public GitHub or a separate booking site.
- The old `admin.html` remains as a legacy fallback; it is not a required daily work screen.
## Implemented in this branch
- Admin-authenticated `busy-list`, `busy-upsert`, `busy-delete` for manually entered appointments from HANA WORKSPACE.
- An active interval closes only overlapping slots, without mutating original manual `slots.status` or `closed_dates`.
- DB-level triggers reject new reservations, reactivation and checkout on blocked slots; previously placed orders remain intact and appear in a conflict list for human handling.
- Deletion removes only the agent-created busy overlay; never reopens independently closed slots.
- Cross-origin admin requests are restricted to `HANA_WORKSPACE_ORIGIN` (and the Worker's own origin) and still require `ADMIN_TOKEN`. Browser credentials are memory-only.
- No student contact information or access keys are committed to the public repository.
## Google Calendar synchronization (implemented in source, NOT activated)
- The Worker `scheduled` handler polls a single **dedicated private calendar** every 10 minutes, only after secure credentials and the calendar ID are configured. A manager may also use authenticated `calendar-sync` (synchronize now).
- Events are fetched via Google Calendar Events.list with `singleEvents=true`, `timeMin`/`timeMax` and pagination for 120 days ahead; deleted, transparent/free and working-location events are ignored. All-day events use Taiwan local dates. Google event names are replaced with a private generic label before saving to D1.
- Reconcile only the `google` busy-overlay source in one transactional D1 batch: missing Google instances become inactive, without reopening manually closed slots or modifying existing orders. When Google API/authentication fails, existing blocks are preserved. Migration 0011 uses a monotonic start-time guard to reject outdated overlapping syncs, including older error results.
- Authenticated `calendar-status` and `calendar-conflicts` endpoints show last successful sync and existing-booking collisions; no student or event details are available from public `/api/slots`.
- Configure a dedicated Calendar named (for example) `HANA｜停止接受預約`. ONLY events on this Calendar block public slots; keep course registrations and group teaching events on other calendars to prevent accidentally closing all classes.
- Cloudflare Worker Secrets: `GCAL_SERVICE_ACCOUNT_JSON` (Google Cloud service account credentials, stored as secret) and `GCAL_BUSY_CALENDAR_ID` (the exact dedicated calendar ID, stored as secret). Grant the service account email **See all event details** on only that dedicated calendar, read-only. Enable Google Calendar API for the service account's project. Do not copy credentials to GitHub, this conversation or client JavaScript.
- Optional Worker vars `GCAL_BUFFER_BEFORE_MINUTES`, `GCAL_BUFFER_AFTER_MINUTES`: integers 0–240. Time conflict includes buffers; choose appropriate travel/prep allowances.
- Expected sync is periodic, **not instant**. The last-success timestamp in the HANA dashboard must be checked. A newly added Google event can overlap a booking placed before the next successful poll.
## Not yet implemented
- Automatically importing events from an unrestricted personal Google Calendar; explicit source selection remains required. Automatically creating Calendar events from public bookings is also not yet implemented.
- Unified single sign-on. The current HANA page requests the existing administrator token in-memory once per tab; it is not a second site, but it is a temporary authentication mechanism.
- Reminder or LINE notifications.
## Deploy only after review
1. Merge PR after CI and migration/schema review. Production site stays unchanged before merge and deployment.
2. **Back up production D1**, then apply migrations `0009_busy_intervals.sql`, `0010_google_calendar_sync.sql` and `0011_calendar_sync_order.sql` to the correct production D1 binding. Verify existing order/slot counts before and after.
3. Deploy the Worker with `HANA_WORKSPACE_ORIGIN` set to the actual HTTPS origin hosting HANA WORKSPACE. Confirm HTTPS Origin/CORS plus token and verify private data cannot be read anonymously.
4. Publish HANA FOCUS's matching UI PR; log in from the same HANA WORKSPACE page. The UI on its own will return an error until the backend is deployed.
5. In staging: create a block overlapping a test slot; check public `/api/slots` reports closed; confirm a new order is rejected; remove block; verify manually closed slots stay closed.
6. Create a block overlapping an existing paid/pending order: confirm conflict is reported without cancellation, seat release or refund; complete manual resolution.
7. Stage the dedicated Google Calendar with a harmless test event; configure secrets only in staging first. Verify a recurring instance, all-day event, cancellation, API failure, collision alert and manual-closure preservation. Do not enable production sync until it passes those checks.
8. Production rollout requires deployment approval, actual Google Calendar sharing and separately configured Cloudflare secrets. GitHub commits alone are not deployment.

## Required user authorization before enabling production
- Owner selects **one dedicated Google Calendar** that represents unavailability; Google Calendar currently has no such separate calendar, so it must be created and granted read access before turning on synchronization. The account's primary calendar must **not** be synchronized wholesale without an explicit opt-in rule.
- Owner explicitly approves sharing this calendar read-only with the Google service-account identity, once that identity is established in a private Google Cloud project. Service-account JSON is saved directly to Cloudflare Secrets without placing it in a chat or GitHub.
- Owner separately approves Cloudflare staging / production access, D1 backup+migrations and Worker deployment only after staging test evidence is reviewed. Do not interpret GitHub PR approval as permission to execute a production data migration.
- All Google Calendar and Cloudflare authorization/setup remains pending. No live sync is active at time of this PR.
