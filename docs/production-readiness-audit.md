# Operations dashboard readiness audit — 11 September 2026

The local implementation builds successfully, but production readiness is **not yet verified**. This review covers the application code, configuration names, read-only provider checks and isolated integration tests. It is not a reconciliation of every production order, a live email delivery test or a completed visual browser acceptance test.

## Implemented in this checkout

- Removed the preview sign-in banner, the “existing section available after signing in” placeholders, page subtitles and repeated decorative live indicators. Existing sections are visible in development preview; protected APIs remain protected.
- Added one header status based on the order-sync health endpoint. It distinguishes offline, delayed, running and recent successful sync. It does not certify Gmail delivery, inventory completeness or financial accuracy.
- Added shared native dialogs with keyboard dismissal, focus containment, background scroll locking and close controls. Component/vendor/PO/recipe/sale entry, receiving, invoice uploads, support replies/notes, assignment/priority/status, escalation, user creation/password/roles and campaign creation use dialogs. Search and date filters remain inline.
- Campaign creation is one continuous scrollable form, without numbered stages or section cards.
- Removed NDR-based guessing from OFD attempt counts. First/second/third counters now explicitly count **recorded OFD days**, not certified courier attempt ordinals. Orders without event history are classified as history unavailable. “Previously undelivered” requires a prior failed event.
- Added a bounded background order importer and one-minute cron declaration. It checks the newest page every run, continues a backlog cursor, uses an overlapping two-day update window and a database lease, and only advances freshness after the backlog finishes.
- Webhooks lacking a Shiprocket order ID now also trigger recent-order ingestion. Detail-fetch failures are no longer swallowed as success. Older recorded webhook events cannot overwrite newer recorded webhook status. Source requests have timeouts and reject empty successful HTTP bodies.
- Fixed the “running forever” status after a partial full import. A manual sync remains available for recovery.

## Findings and release gates

| Area | Evidence/current state | Required next action |
| --- | --- | --- |
| Local sign-in | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are missing locally. These settings, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` exist in Vercel production. | With owner authorization, copy only this project's existing settings into ignored local configuration, restart, and verify the existing administrator account. No database replacement. |
| Local database | The old local Neon fallback returned SQLSTATE 53000, data-transfer quota exceeded. | Use the existing production Supabase connection for authorized verification. **This does not establish a Supabase production quota failure; do not upgrade Neon just to fix this checkout.** |
| Production sign-in | Setting names are present, but values/account status have not been verified. | Verify matching Supabase project URL/key, enabled email/password provider, existing user and admin app-metadata role. Sign-in now distinguishes invalid credentials from unconfirmed email and service failure. |
| Shiprocket | Live login returned HTTP 200 and an order-list request returned 100 records, all NEW. This is one newest-page sample, not the whole store. Existing credentials were restored from `.dev.vars` into `.env.local`, which Next actually reads. | Reconcile production DB rows against the channel's full paginated source, then inspect callback delivery logs. |
| Shopify | Neither local nor inspected production setting names contain the required direct Shopify domain/token. The app has a catalog sync implementation, but no verified direct Shopify connection. | Supply the existing `.myshopify.com` domain and Admin API access token in the secret editor. Verify scopes and catalog pagination. Shiprocket having a Shopify channel does not establish a direct dashboard Shopify connection. |
| Automatic order sync | Previously only twice-daily server reconciliation; browser polling only reread stored data. New minute importer is implemented, not deployed/activated. | Deploy with a supported scheduler and existing CRON_SECRET, verify successful invocations, then create a controlled order and measure arrival with the browser closed. |
| Webhook delivery | Handler code inspected; delivery URL/auth and provider callback logs not verified. | Verify the production HTTPS callback is `/api/webhooks/shiprocket` (tracking alias also supported), the configured token matches, and deliveries receive 2xx. Webhooks plus reconciliation are complementary. |
| Exact OFD attempt number | Old formula combined distinct OFD dates and NDR totals. Repeated same-day attempts cannot be recovered from day counts; historical records may be incomplete. | Keep “recorded OFD day” labels until complete courier attempt evidence is available. Compare tracking histories for each selected date; do not certify first/second/third courier attempts from these totals. |
| Historical OFD coverage | Source-history refresh is bounded and includes a recent-shipment selection. It can omit older open shipments. | Complete historical backfill and record per-shipment coverage before certifying historical totals. |
| Analytics definitions | Order-date cohorts use Asia/Kolkata. The attempted-outcome denominator includes delivered, RTO and undelivered; NDR is not necessarily final closure. | Preserve the requested formula but use precise labels. Validate totals, status coverage and financial amounts against source exports. Refunds/discounts/tax/settlement reconciliation is not established. |
| Inventory | Local integration tests cover receipt idempotency, conversion, reservation/consumption, sales and QC. Recipes may remain empty. | Verify existing production RLS/schema and private invoice storage. Map products and add recipes before expecting automatic stock consumption. Missing recipes must not generate guessed stock movements. |
| Customer support | Ticketing, assignment/escalation, OAuth, renewal and reply outbox implemented. Mailbox is not connected. | Complete the Google Cloud/OAuth owner steps in `operations-go-live.md`, authorize kritika@satmi.in and verify controlled inbound/reply/push delivery. No real customer email was sent during this review. |
| Access | APIs require authentication; sensitive inventory/support actions enforce roles. Legacy order/analytics read endpoints allow general authenticated dashboard users. | Confirm whether support/warehouse users should see all order/customer/financial data before granting accounts. |
| Deployment configuration | Legacy Sites/Cloudflare/D1/SQLite metadata coexists with current Next/Vercel/Postgres runtime. | Establish Vercel as the release target and archive obsolete tooling deliberately; do not apply legacy SQLite migrations to Postgres. |
| Operational resilience | Fast sync has a lease/cursor; callback history persists. There is no complete per-event dead-letter/replay management UI, and no verified production alerting. | Add delivery-failure alerting and durable event replay for stronger SLAs; test rate limits, outages and burst imports. |

## Freshness expectations

After production activation, a delivered Shiprocket webhook updates the server without anyone opening the dashboard. The minute scheduler catches missing/new orders independently; the UI's existing polling then displays stored changes. This is near-real-time **from when Shiprocket exposes an order**, not a guarantee of instantaneous Shopify checkout visibility. Shopify-to-Shiprocket propagation, provider outages/rate limits, backlog size and scheduler delays still apply.

For visibility immediately after Shopify checkout, add a separate authenticated Shopify orders webhook intake with HMAC validation and idempotent event storage, keeping Shopify identity distinct until a Shiprocket order is linked. That direct intake is not implemented here and cannot be activated with the currently missing Shopify configuration.

Vercel Pro/Enterprise supports minute cron intervals; Hobby allows daily jobs only and rejects more frequent schedules. An existing compatible external scheduler can call the authenticated endpoint instead. Do not purchase a plan without confirming the current team's plan. Source: [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Exact owner actions

1. Approve copying only the existing dashboard's Supabase connection/authentication settings and CRON_SECRET from its Vercel deployment to ignored local configuration. Alternatively add those five settings directly in the local secret editor. Do not paste credentials in chat.
2. Provide the Shopify shop domain and Admin API token through the secret editor if you want the direct catalog connection. Confirm the existing integration's scopes in Shopify.
3. Provide Google Cloud project access/client credentials and personally approve Gmail authorization for kritika@satmi.in. The setup script handles Pub/Sub configuration once access is available.
4. Confirm the intended production release target and scheduler availability. Deployment, real database reconciliation, webhook validation and controlled acceptance checks should follow before calling this production ready.

Automatic approval review rejected retrieving production secrets without explicit owner authorization. No production credentials were exported in this audit. The authorization question remains pending.

## UI recommendations after the current cleanup

- Put one primary action in each page toolbar; keep destructive or infrequent actions in a row menu.
- Use consistent field heights, modal widths, buttons and status badges. The shared dialog now provides this foundation.
- Keep important counts prominent; move metric definitions to tooltips and operational errors beside the affected action.
- Add persistent saved filters, sortable columns and a density preference for order-heavy workflows.
- Keep ticket owner, status and next action visible together; use named status badges instead of descriptive slogans.
- Complete keyboard/mobile acceptance across each role with real populated data. Empty preview screens cannot establish table usability at production volume.

## Validation

- Production webpack build and TypeScript passed before the final text-only audit write.
- ESLint and six existing regression checks passed; final verification recorded in the task response.
- Three added isolated Postgres tests cover OFD date/deduplication/NDR behavior, concurrent-sync exclusion/empty-response failure, and multi-run pagination/freshness.
- Prior operations integration checks cover stock and support behavior with mocked external email delivery.
- No production deployment, provider configuration mutation, production data repair, or real email send was performed.

## Follow-up configuration update

Shopify was subsequently configured and verified: 74 products / 116 variants fetched read-only into ignored local storage. Database import remains blocked. Frequent Vercel cron declarations were replaced by the external VPS scheduler described in `dashboard-setup-and-vps.md`. The sign-in page now handles missing configuration without crashing, and the preview account action offers Sign in.
