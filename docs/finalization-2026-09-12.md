# Finalization changes — 12 September 2026

Implemented locally; not deployed. Migration `0015_invoice_receiving` is versioned in the existing operations migration runner and has been exercised against isolated local Postgres.

## Campaigns and confirmation

- Removed the Permanent badge; centered the grip, elevated the dragged card, animated other cards into their new positions, and restored ordering on a failed save/cancelled drag.
- Renamed Manual override to Pause automatic routing. It disables future automatic assignment while retaining current assignments. Manual campaigns select current orders explicitly; this control is not a parameter editor.
- Callback and no-answer are direct icon buttons; subdued solid accept/reject controls remain in the sticky right column.
- Removed the nested confirmation modal styling and duplicate close button.
- Fixed database result aliases (`orderId`, `rejectionReason`) that prevented call attempts and mandatory confirmation notes from being attached to orders. Confirmed notes also appear in Orders.
- Complete phone values take precedence over masked values; sync no longer overwrites a complete number with a blank/masked value.
- Refresh Shopify phones & tags performs bounded, exact-order-name lookups for Shopify orders and persists values. Shopify returned phone data in all five recent orders sampled on 12 September; full queue coverage has not been measured because local `SUPABASE_DB_URL` is absent. No customer data is printed by the coverage script.

## Orders and analytics

- New retains its selected state when Approved is selected.
- Low risk + approved is a union, shown only under New. Approved is also scoped to New.
- Shared search/date/payment/courier/pickup/tag filters apply to Approved as well as the other order categories. Tags match whole values rather than substrings.
- One calendar selects and applies both dates. August 1–31 was checked interactively.
- Attempted denominator: delivered + all RTO statuses + undelivered/NDR + out for delivery. In transit is excluded.
- Shipped denominator: attempted statuses + shipped/in-transit/destination-hub/picked-up/misrouted/untraceable + lost. Ready to ship and pickup exception are excluded.
- Transcript arithmetic: 2,392 / 3,105 = 77.04%; 2,392 / 3,118 = 76.72%. These are examples from the transcript, not verified live totals.
- Shipment status reconciliation shows the filtered status counts and inclusion in both denominators. No source report was attached, so historical totals are not certified.

## Inventory and support

- Component/adjustment actions are above the stock table; navigation tabs have an underline treatment distinct from action buttons.
- Vendors collect address and bank details alongside contact/GST fields. PO creation includes terms/delivery instructions and provides a printable export (Save as PDF). Exact requested PO format is pending the template.
- Both reviewed PDF imports and manual PDF/image invoice uploads link quantities to PO lines.
- Receiving requires an uploaded invoice for that PO, and cannot exceed its unreceived quantities. Invoices are rechecked after receiving.
- PO completion uses accepted quantities only. The exact 50 kg scenario (25 + 23 + 2) passes, along with duplicate-receipt and invoice-exhaustion tests.
- Positive stock additions must use invoice-backed PO receiving; adjustments only reduce stock. Existing return/QC recovery keeps its original audit trail.
- Inventory log shows actor, date, invoice/reference and readable line descriptions/quantities, with full event details available.
- Support retains case IDs, least-loaded available-agent assignment, manager reassignment, escalation and the email outbox. Added manually logged tickets and an inline reply/internal-note composer. Manual tickets attach to their actual Gmail thread on the first successful reply.
- No real support email was sent during testing.

## Validation and remaining inputs

Build, TypeScript, ESLint, six UI/source regressions, and local Postgres operations/document/sync/finalization tests were run. New tests cover status populations, exact tags, masked phone fallback, 25/23/2 kg receipts and least-loaded manual-ticket assignment.

For local tests use `SATMI_TEST_PORT=55441 node --import tsx --test --test-concurrency=1 tests/*.test.ts` with an isolated `satmi_test` Postgres database; default test port remains 55439. Do not point tests at deployment data.

Remaining: inventory and CRM screenshots, standard PO template, and dated source reports for a row-by-row analytics reconciliation. Production database migration, full phone backfill and live browser acceptance have not been performed.

Reference checks: [Shopify Order fields](https://shopify.dev/docs/api/admin-graphql/latest/objects/order), [Zendesk Agent Workspace](https://support.zendesk.com/hc/en-us/articles/4408821259930-About-the-Zendesk-Agent-Workspace/).

## Loading, PO files and CRM follow-up
Order counts now use one grouped scan rather than repeated count scans. Filter options are cached for 60 seconds with concurrent-request deduplication. Campaign candidate scans run only while creating a campaign. Orders fetch only in the orders view, searches debounce for 300 ms, and reads have a 25-second timeout.

Purchase orders retain all editable reference fields in document_json. The authenticated PDF endpoint creates a finalized Satmi-format PDF, including GST calculations and page breaks for longer tables. The blank public Excel template contains six editable line rows and formula totals, with A4 PDF print settings. Both reference totals were checked: 107380 and 23520. Private reference details are not in the public repository.

The support layout follows Zendesk Agent Workspace's list/conversation/context pattern (https://support.zendesk.com/hc/en-us/articles/4408821259930-About-the-Zendesk-Agent-Workspace/). Existing Gmail delivery, internal notes, assignment and escalation behavior remain intact.

Shiprocket reconciliation can run in deployment via VALIDATE_SHIPROCKET_ON_DEPLOY=true, optionally refreshing authoritative order fields with RECONCILE_SHIPROCKET_ON_DEPLOY=true. It compares July–September records and independently classified status counts against database analytics SQL, preserving confirmations and Shopify tags. Aggregate results are stored in sync_state.shiprocket_validation_json; raw provider files remain ignored.

Validation: 16 database integration tests and 2 cache/PDF tests passed. TypeScript and production build passed. Excel formulas and rendered PDF/Excel output checked. No customer emails were sent in testing.
