# HANA FOCUS Calendar bridge (not enabled by default)

Paired with the hana-focus calendar-sync-review change. Adds a dedicated server-to-server POST endpoint `/api/focus/calendar-sync`, authorized only with the new `FOCUS_SYNC_TOKEN` secret. ADMIN_TOKEN does not grant this route. Never place the token in browser code, public logs, GitHub or a command argument. Store its matching value as RESERVATION_SYNC_TOKEN in the existing Supabase project through secure secret entry.

Snapshot/get expose only course/slot metadata and aggregate enrolment, with no customer contact/payment records. Apply accepts only date/time/status. Its UPDATE compares the original schedule, capacity, enrolled count, enabled flag and closed-date state atomically. A newly enrolled seat invalidates an old command. Enrolled changes require a human-approved review ID from the trusted HANA FOCUS service. The service must validate that review and both current snapshots before sending this command; possession of the dedicated token is privileged and never delegated to a browser.

Google deletion closes intake, retaining enrolled orders and payments; it does not refund, send notices or cancel customer orders. Existing course admin functions, catalogue, checkout/payment routes, DNS and Cron remain unchanged. Deployment alone does not activate this bridge unless its dedicated secret has been securely configured.

Tests: `node --test test/*.test.mjs` from payment-worker (31 passed on Node 24). Includes SQLite race tests and proof that ADMIN_TOKEN alone cannot authorize sync.
