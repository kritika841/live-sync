# Dashboard and analytics audit — 14 September 2026

## Production changes

The production database contained approximately 4,000 recent orders despite the dashboard having marked an earlier full sync complete. The supplied Shiprocket export contains 18,484 distinct Shopify_5 orders across 35,959 product rows. Product rows must not be counted as orders. The authoritative API returned every source order plus newer orders; the historical repair imported current API statuses rather than rewinding them to the export's snapshot.

All 18,484 source order IDs were verified present after the repair. The database then contained 18,488 Shopify_5 orders (four newer than the report). January–August counts, delivered counts, attempted/shipped denominators, and delivered revenue matched the source exactly. September includes subsequent status changes. Counts continue to change with legitimate live updates.

| Month | Orders | Delivered | Attempted denominator | Shipped denominator | Delivered revenue ₹ |
|---|---:|---:|---:|---:|---:|
| January | 180 | 116 | 174 | 174 | 117,535.00 |
| February | 1,918 | 660 | 1,530 | 1,532 | 443,864.00 |
| March | 4,610 | 1,577 | 3,278 | 3,284 | 1,089,855.00 |
| April | 2,195 | 844 | 1,915 | 1,918 | 592,380.00 |
| May | 1,941 | 740 | 1,610 | 1,620 | 495,832.00 |
| June | 1,489 | 571 | 1,242 | 1,247 | 349,447.00 |
| July | 1,291 | 650 | 1,073 | 1,074 | 464,796.48 |
| August | 3,272 | 2,396 | 3,109 | 3,121 | 2,369,692.00 |

## Correctness fixes

- Removed the requested Shipment status reconciliation block from analytics.
- Fixed PostgreSQL result-name casing that made In transit and Non-shipped show zero despite matching orders.
- Courier and state charts now respect the selected attempted or shipped denominator. State-name capitalization variants are grouped together. Destination-hub status spelling variants are recognized.
- Analytics is scoped to the configured Shopify_5 channel and uses order-date cohorts in Asia/Kolkata.
- Money is stored as NUMERIC(14,2), eliminating the observed two-paise July aggregation error from single-precision REAL.
- Two provider payloads contained unsupported null characters. Those two source-report orders were repaired without changing status, financial or workflow fields; future imported strings are sanitized before JSONB operations.
- Missing historical freight/event metadata was taken from the source export while retaining current API status. Filled 1,864 missing NDR reasons without replacing existing reasons.
- Provider requests use explicit ISO creation dates beginning January 2026, the earliest verified Shopify_5 history, alongside updated-date filters. Earlier dates would require extending this bound and reconciling an older source. Textual dates select a legacy provider response with unreliable pagination and repeated order rows; that path is avoided.
- Malformed provider responses cannot mark a sync complete. Duplicate provider order IDs are deduplicated before an atomic bulk upsert. Cross-channel responses are rejected.
- Historical repair bypassed confirmation routing and stock allocation side effects. All 4,036 pre-existing orders were compared with the pre-repair backup: confirmation status, confirmed/rejected timestamps and assignee IDs were unchanged.

## Loading and resilience fixes

- Replaced postgres-js wire operations with node-postgres behind the existing parameterized query/transaction interface. Requests own their connections, have bounded deadlines, and close their sockets. Transaction rollback and isolation are regression-tested.
- TLS certificate and hostname verification remain enabled using Supabase's public root CA.
- Removed repeated database preflight queries and unnecessary schema DDL on installed schemas.
- Stored derived risk values and indexed them, so counts no longer repeatedly parse every full provider JSON payload. A production risk-count query completed in 158 ms. The actual complete overview implementation completed in 2.40 seconds across 18,488 orders; January completed in 2.76 seconds including connection setup. These are point measurements, not a load-test guarantee.
- Replaced the OFD event OR join with indexed, deduplicated joins and installed six supporting read indexes.
- Confirmation responses select contact/tag metadata instead of entire provider payloads: approximately 84% less data in the measured queue response.
- Support search is debounced; stale requests cannot replace a newer selection. Polling avoids overlapping requests. Panel failures show retry states instead of false empty results or indefinite loading.
- Supabase browser authentication refreshes its session; upstream authentication failures are distinguished from a signed-out user. A production Supabase 504 was reproduced and recovered on retry. Server identity checks now use one bounded retry for transient gateway/network failures, without accepting an unverified session.
- Background provider import failure is recorded without blocking deployment of a healthy dashboard. Scheduled synchronization remains responsible for subsequent retries.

## Verification

- Optimized production build and ESLint passed.
- 29 regression tests cover operations permissions, receipt/invoice transactions, documents, rollback, independent requests, timeout recovery, analytics output, state grouping, exact revenue, OFD history, provider duplicates and invalid payloads.
- Production dependency audit reported zero known vulnerabilities (`npm audit --omit=dev`). Development dependencies retain audit findings; this is not an exhaustive security assessment.
- The signed-in production browser loaded 86 support conversations across two pages and opened a ticket's message history. Confirmation loaded 115 queued orders; inventory and reports loaded. The final build also loaded today’s OFD register with 37 orders, including an explicit unknown-history count. January displayed 180 orders, 116 delivered and ₹117,535 revenue. The shipped view displayed nonzero transit/non-shipped counts and changed chart denominators correctly. The recent-order backlog completed with pending=false at 09:32 IST.
- Protected data remains behind existing authentication/role checks. No customer replies were sent and no campaign or confirmation actions were exercised. The subsequent user-authorized invoice receipts were posted through the same validated inventory service used by the application.

## Operational limits

Historical order/status/revenue reconciliation does not reconstruct courier scans that were never recorded. OFD attempt ordinals remain explicitly unknown without sufficient event history; the app does not fabricate them from an NDR count.

A Supabase notice visible in the support inbox reports the organization exceeded its bandwidth quota and is in a grace period through 14 October 2026. Reduced payloads help, but provider billing/resource limits remain an external availability risk. No plan purchase or billing change was made.

Backups and raw source/API artifacts are retained locally under the ignored `.local/analytics-audit/` directory and were not published with the site. Database migrations are in `migrations/0018_dashboard_read_indexes.sql`, `0019_orders_exact_money.sql`, and `0020_orders_risk_read.sql`; they were applied to production before the dependent code deployment.


## Follow-up analytics, helpdesk and inventory repair

The initial risk metric used the provider risk field. The user clarified that Shopify order tags are authoritative. Migration 0021 now stores Shopify tags and risk separately: exact normalized `high` or `rto prediction high` means high; an authoritative tag fetch without those tags means low; missing Shopify verification means unknown. 18,491 stored orders were checked against Shopify. At the verification snapshot of 18,498 orders, the split was 940 high, 17,551 low, and seven unknown newer orders. The fast-sync cron now refreshes recent Shopify tags with paginated progress.

The Orders options query was still parsing complete raw JSON for every order. It now uses generated tag arrays and an index. Request pools permit three concurrent queries rather than queuing all inventory reads behind one connection. Deadlines, TLS verification and request cleanup remain enabled.

NDR history now includes any order with a recorded NDR reason, attempt or raised date, including orders subsequently delivered or returned. 1,724 missing raised dates were restored from 7,722 source orders with NDR dates. The verified overview contained 7,741 historical NDR orders across 42 reason categories, versus 82 currently undelivered. The chart shows all categories, counts each order once under its latest available reason, and labels absent reasons explicitly. Full overview verification took 3.04 seconds, a point measurement.

Customer support uses vertical queues, a ticket list and conversation workspace. Opening it collapses the global sidebar. User name and email appear at the bottom of the expanded sidebar; collapsed mode retains an identity tooltip. Inventory action controls now precede the tables/cards. Inactive catalog items no longer count toward missing active-product recipes.

Shopify catalog refresh found 75 products and 117 variants, 100 active. All active variants lacked SKUs. Inventory order matching now accepts an exact Shopify variant ID from Shiprocket channel_sku, without matching blank identifiers. Each active variant has a finished-goods component and one-unit recipe; no finished-goods quantities were invented. Existing manual products are not deactivated by Shopify refresh. Actual raw-material consumption recipes still require real per-product quantities.

### User-authorized stock receipts

All four source PDFs were visually reviewed. The parser now skips HSN numbers and joins wrapped numeric/description rows; previously these could produce wildly incorrect quantities. PO review retains GST percentages. Original PDFs are in private storage; authenticated signed downloads were checked against all four original SHA-256 hashes.

- Invoice A000122: 193.55 kg received.
- Invoice A000120: 312.20 kg received.
- Total: 505.75 kg across Chandan 31.20, Gulab 98.95, Hawan 91.80, Kesar Chandan 136.95, Nagchampa 80.50, and Oudh 66.35 kg.
- PO-2026-0020: ₹107,380 including GST, zero received.
- PO-2026-009: ₹23,520 including GST, zero received.

The invoices had no corresponding supplied vendor POs, so clearly labeled internal RECEIPT-REF records preserve their receipt lineage. They are explicitly documented as reconstructed invoice references, not original supplier orders. Receipt idempotency prevents duplicate credit.

RTO stock becomes available only after a received-return status and accepted QC quantity. In-transit RTO cannot be restocked. Regression tests cover fulfilment matching when SKU is blank, consume-once behavior, rejection of premature RTO restocking, partial damaged recovery, and repeat-QC idempotency. This does not retroactively invent warehouse receipts for historical RTO orders.

Production stock totals, active recipe coverage (100/100), both PO totals and zero received quantities, and four private original PDF downloads passed read-only assertions. Local tests use an isolated PostgreSQL database; test stock never enters production. Local source artifacts and inventory backup are under ignored `.local/inventory-audit/`.

The latest browser verification loaded 18,500 orders and page 2 of the new-order queue (50 rows). The background sync health check returned recent HTTP 200 responses with no recorded error. The badge previously treated only a completed history sweep as fresh; it now uses successful incremental-check time and labels an unfinished sweep “Syncing history”. This distinguishes recent order updates from a completed history pass without claiming the backlog is finished.

## Risk and NDR source re-audit at 10:10 IST

A new complete Shopify GraphQL pass returned 18,505 orders through 14 September 2026 at 10:09 IST. Exactly 940 orders had the normalized `high` or `rto prediction high` tag. Shiprocket's stored RTO Risk field independently contained 2,848 high and 307 very-high orders. Of the 940 Shopify-high orders, 896 overlapped a Shiprocket-high order. The reliable union is therefore 3,199 historical high-risk orders: Shopify 940 plus Shiprocket 3,155 minus 896 overlaps. Five stored orders had neither a usable Shopify nor Shiprocket risk at the production-query snapshot.

The 16 August–14 September filter in the supplied screenshot contained 3,362 orders. Within that cohort, Shopify identified 165 high, Shiprocket identified 148 high/very-high, 147 overlapped, and the deduplicated union was 166. The apparent 165-versus-thousands discrepancy was principally selected-period versus all-history scope, combined with omission of older Shiprocket risk assessments. Analytics, Orders filtering, and confirmation SQL now use the same rule: high if either source explicitly says high; low only if at least one source says low and neither says high; otherwise unknown. The analytics card presents selected-period results together with the all-history reference and source overlap.

The production database has 7,741 orders with an NDR status or recorded NDR reason, attempt, or raised date. The screenshot's selected order-date cohort contains 742 of them; 81 are currently undelivered and 420 of those historical-NDR orders later moved into an RTO status. NDR history deliberately follows the original order-date filter while retaining later outcomes. Its card now shows the 7,741 all-history reference above the selected-period reason distribution.

## UI audit priorities

1. Raise the core text scale. The stylesheet contains 236 declarations at 8–10 px; filters, table metadata, help text and status chips are hard to scan at normal desktop distance. Adopt 12 px as the metadata floor, 14 px for table content and 16 px for normal explanatory text, with a slightly tighter optional table-density mode.
2. Make scope persistent and unmistakable. Analytics cards previously looked like lifetime totals even though the default filter was 30 days. Keep a visible date-range chip in every scoped section, add quick presets for 7 days, 30 days, month-to-date and all history, and preserve the last chosen range per user. The risk and NDR cards now take the first step by labeling selected-period values and showing all-history references.
3. Replace the header search behavior outside Orders. The field says “Search dashboard” to assistive technology, but typing always switches to Orders. Hide it on non-order workspaces or turn it into an explicit command/search palette; each workspace should retain its own local search.
4. Use progressive loading skeletons. Confirmation briefly presents a large empty bordered panel with one centered spinner, and several workspaces initially show zeros before data arrives. Preserve the previous successful data during refresh, skeleton only the changing rows, and show a small “updated at” indicator rather than clearing the whole surface.
5. Reduce navigation depth and visual sameness. Nine peer items in one icon rail make operational tasks, analysis and administration appear equally important. Group Orders/Confirmation/Campaigns, Inventory/Procurement, Support, and Analytics/Reports; keep Admin and Activity in a utility section. Provide text labels by default on desktop and remember collapse state.
6. Improve dense-table ergonomics. Keep the primary identity and status columns sticky, allow column visibility controls, and make row click targets open a consistent detail drawer. Long product names currently dominate the Orders table while actionable shipment information is pushed right.
7. Clarify system health. “Syncing history” is now distinct from recent-order freshness, but the Activity log still uses separate vocabulary and can briefly say “Not yet.” Use one shared health model across the header, Orders, Reports and Activity log, with separate timestamps for recent orders, Shopify tags, support mail and historical reconciliation.
8. Strengthen responsive behavior. The helpdesk has a good narrow-layout fallback, but eight-column Orders and reconciliation tables depend on horizontal scrolling. For tablet/mobile, switch rows to compact cards with order, customer, amount, status and one primary action; move secondary fields into a drawer.

The risk card no longer stretches to the full height of the NDR reason list, and NDR reason labels use more of the available width. These two visual corrections ship with the data-source change.

## Implemented UI and final production verification

The structural UI priorities above are implemented. After live review, the temporary 12–14 px typography increase was reverted to the dashboard's original compact text scale. Analytics and Orders include 7-day, 30-day, month-to-date and all-history presets; their selected dates persist in local storage. The global search exists only in Orders. Orders, Confirmation and Reports use row skeletons on their first load, while successful data remains visible during refreshes. The sidebar is grouped into Operations, Inventory, Support, Analytics and Administration, with the signed-in identity anchored at its bottom. The Manage users link uses the same icon size, spacing and alignment as the sidebar buttons.

Orders now has persistent column visibility controls. Order identity stays sticky on the left and status on the right on desktop; at 1,000 px and below, Orders and report-history rows become two-column cards, then single-column cards at 700 px. The header, Reports and Activity log all render the same `LiveStatus` component and `/api/health/sync` state.

The visible explanatory paragraphs previously added to the RTO and NDR cards were removed. The cards retain compact selected-period and all-history labels. At the final live verification snapshot, the 16 August–14 September cohort contained 3,367 orders: 166 high risk and 3,201 low risk. Historical high risk remained 3,199. NDR history increased to 7,743 as new provider events arrived. These live changes are expected because the source sync remains active.

Production verification found one remaining Confirmation failure caused by an intermittent Supabase Auth user lookup. Dashboard API authorization now uses Supabase `getClaims()`, which cryptographically verifies the signed access token and avoids a remote user lookup on every panel request. No unverified cookie identity is accepted. After deployment, Confirmation loaded 115 queued orders in approximately 5.7 seconds without an auth or signal timeout. Orders loaded 18,506 records, Support loaded 86 tickets, Analytics loaded its selected cohort, Reports loaded its saved reconciliation record, and Activity log loaded recent webhooks. The Analytics seven-day range and an Orders column choice both survived a full reload; the test preferences were restored to 30 days and all columns afterward.

Final production deployment: `dpl_DwfzzA2t2syjnxuB43nnvwNhqFLD`, aliased to `https://live-sync-theta.vercel.app/`.
