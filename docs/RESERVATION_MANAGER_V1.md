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
## Not yet implemented
- Automatic Google Calendar event ingestion or writing bookings to Google Calendar. This needs a separate private, authorized Calendar integration (e.g. a Google service account shared to a designated busy calendar with a secure Worker secret), explicit inclusion/exclusion rules, recurring-event expansion and sync reconciliation. Never assume all Google Calendar events block courses: scheduled classes may be group bookings.
- Unified single sign-on. The current HANA page requests the existing administrator token in-memory once per tab; it is not a second site, but it is a temporary authentication mechanism.
- Reminder or LINE notifications.
## Deploy only after review
1. Merge PR after CI and migration/schema review. Production site stays unchanged before merge and deployment.
2. **Back up production D1**, then apply migration `0009_busy_intervals.sql` to the correct production D1 binding. Verify existing order/slot counts before and after.
3. Deploy the Worker with `HANA_WORKSPACE_ORIGIN` set to the actual HTTPS origin hosting HANA WORKSPACE. Confirm HTTPS Origin/CORS plus token and verify private data cannot be read anonymously.
4. Publish HANA FOCUS's matching UI PR; log in from the same HANA WORKSPACE page. The UI on its own will return an error until the backend is deployed.
5. In staging: create a block overlapping a test slot; check public `/api/slots` reports closed; confirm a new order is rejected; remove block; verify manually closed slots stay closed.
6. Create a block overlapping an existing paid/pending order: confirm conflict is reported without cancellation, seat release or refund; complete manual resolution.
7. Calendar sync is **not enabled** until independently implemented and verified. Never claim otherwise.
