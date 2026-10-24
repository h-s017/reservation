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
- The Worker `scheduled` handler polls the **existing Google Calendar selected by the user** every 10 minutes (mode `primary_review`), but only after separate read-only authorization, Worker Secret setup and deployment. A manager may also use authenticated `calendar-sync`.
- Events are fetched via Google Calendar Events.list with `singleEvents=true`, `timeMin`/`timeMax` and pagination over at least 120 days, extended to cover the last published session. In `primary_review` mode, confirmed timed busy events block bookings, published-class reminders and ambiguous all-day events require review, and deleted/free/declined events are ignored. Only a generic Google busy label is saved to D1.
- Reconcile only the `google` busy-overlay source in one transactional D1 batch: missing Google instances become inactive, without reopening manually closed slots or modifying existing orders. When Google API/authentication fails, existing blocks are preserved. Migration 0011 uses a monotonic start-time guard to reject outdated overlapping syncs, including older error results.
- Authenticated `calendar-status` and `calendar-conflicts` endpoints show last successful sync and existing-booking collisions; no student or event details are available from public `/api/slots`.
- **User has chosen existing primary Google Calendar, not a second calendar.** See `docs/GOOGLE_PRIMARY_CALENDAR_RULES.md` for exact automatic block/review/ignore precedence, preview interface, and reasons courses stay open.
- Cloudflare Worker Secrets: `GCAL_SERVICE_ACCOUNT_JSON` (Google Cloud service account private credentials) and `GCAL_BUSY_CALENDAR_ID` (**actual user calendar ID**, not the service account's `primary`). The original user calendar needs **explicitly approved read-only sharing** with the service account; alternatively implement a user OAuth flow if sharing is impossible. Enable Google Calendar API and keep credentials out of GitHub, chat and frontend.
- Optional Worker vars `GCAL_BUFFER_BEFORE_MINUTES`, `GCAL_BUFFER_AFTER_MINUTES`: integers 0–240. Time conflict includes buffers; choose appropriate travel/prep allowances.
- Expected sync is periodic, **not instant**. The last-success timestamp in the HANA dashboard must be checked. A newly added Google event can overlap a booking placed before the next successful poll.
## Not yet implemented
- Direct import of personal events without Google Cloud/Cloudflare authorization is not live; rule-based review cannot guarantee perfect prediction. Writing public bookings back into Google Calendar is not yet implemented.
- Unified single sign-on. The current HANA page requests the existing administrator token in-memory once per tab; it is not a second site, but it is a temporary authentication mechanism.
- Reminder or LINE notifications.
## Deploy only after review
1. Merge PR after CI and migration/schema review. Production site stays unchanged before merge and deployment.
2. **Back up production D1**, then apply migrations `0009_busy_intervals.sql`, `0010_google_calendar_sync.sql` and `0011_calendar_sync_order.sql` to the correct production D1 binding. Verify existing order/slot counts before and after.
3. Deploy the Worker with `HANA_WORKSPACE_ORIGIN` set to the actual HTTPS origin hosting HANA WORKSPACE. Confirm HTTPS Origin/CORS plus token and verify private data cannot be read anonymously.
4. Publish HANA FOCUS's matching UI PR; log in from the same HANA WORKSPACE page. The UI on its own will return an error until the backend is deployed.
5. In staging: create a block overlapping a test slot; check public `/api/slots` reports closed; confirm a new order is rejected; remove block; verify manually closed slots stay closed.
6. Create a block overlapping an existing paid/pending order: confirm conflict is reported without cancellation, seat release or refund; complete manual resolution.
7. Stage the **existing calendar** with read-only access first. Verify a real timed meeting, an existing all-day HANA course (must not close itself), a tentative invitation, a transparent/free event, recurring instances, cancellation, API failures and preservation of manual closures.
8. Production rollout requires deployment approval, actual Google Calendar sharing and separately configured Cloudflare secrets. GitHub commits alone are not deployment.

## Required user authorization before enabling production
- Owner selected **the existing primary Google Calendar** (option A). Apply `GCAL_SYNC_MODE=primary_review`; do not bulk-close every busy event. The program marks class reminders and ambiguous all-day events as `REVIEW` and exposes a read-only preview for approval.
- Owner must still separately authorize read-only access for the original Google Calendar to the Google Cloud service-account identity (or explicitly authorize a scoped OAuth integration). ChatGPT Calendar connection does not itself grant Worker access. Service-account JSON is stored in Cloudflare Secrets, not chat or GitHub.
- Owner separately approves Cloudflare staging / production access, D1 backup+migrations and Worker deployment only after staging test evidence is reviewed. Do not interpret GitHub PR approval as permission to execute a production data migration.
- All Google Calendar and Cloudflare authorization/setup remains pending. No live sync is active at time of this PR.
