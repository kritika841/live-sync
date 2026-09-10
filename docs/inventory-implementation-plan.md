# WordSell Inventory Management — Consolidated Implementation Plan

## Outcome

Add an auditable inventory workspace to the existing WordSell operations dashboard. Shopify supplies the product and variant catalogue, purchase orders and receipts govern incoming component stock, product recipes govern allocations, and Shiprocket fulfilment events govern consumption and RTO recovery.

The existing order, confirmation, analytics, OFD, authentication, and administration work remain part of the same production application.

## Canonical stock model

- **Physical stock** is the sum of the append-only component ledger.
- **Allocated stock** is the unconsumed allocation in immutable order requirement snapshots.
- **Available stock** is physical minus allocated, per component and per unit.
- **Incoming stock** is ordered minus received minus rejected on open purchase-order lines.
- Quantities with different units are never added into a single headline total.
- Creating an order reserves components but does not reduce physical stock.
- The first verified `PICKED_UP` transition consumes the reservation exactly once.
- RTO stock returns only after warehouse QC and only for recoverable components.
- Every manual correction requires a reason and writes a ledger entry plus an audit event; balances are never overwritten.

## Delivery phases

### Phase 0 — Credential safety and environment setup

- Rotate the Shopify client secret and Admin API token that were shared in chat.
- Store fresh values only in WordSell/Vercel environment variables.
- Validate the shop domain and configured API version server-side.
- Never expose Shopify credentials to client components, logs, source control, or browser responses.

### Phase 1 — Inventory foundation (started)

- Add component types, components, Shopify variants, versioned recipes, suppliers, purchase orders, receipts, invoices, component ledger, requirement snapshots, provider inbox, and inventory audit tables.
- Add an Inventory workspace to the existing dashboard.
- Show per-component physical, allocated, available, incoming, and reorder quantities.
- Support audited manual absolute-quantity corrections by inserting the necessary ledger delta.
- Support basic purchase-order creation.
- Import the complete paginated Shopify product/variant catalogue without sample data.

### Phase 2 — Reliable Shopify ingestion

- Register and verify Shopify webhooks through an idempotent provider-event inbox.
- Process product and order changes asynchronously and preserve raw payload evidence.
- Run scheduled full reconciliation to repair missed or delayed webhook events.
- Record sync cursors, leases, run summaries, failures, and replay state.
- Add explicit SKU and variant mapping queues instead of silently guessing matches.

### Phase 3 — Recipes, order demand, and FIFO reservations

- Add recipe editing and activation with immutable versions.
- Snapshot the active recipe when an order becomes eligible for allocation.
- Allocate components FIFO from positive ledger lots, with shortage visibility.
- Reallocate safely after cancellations or approved order-line changes.
- Add demand, available-to-promise, shortage, and reorder views.

### Phase 4 — PO receiving and supplier invoice PDFs

- Add multi-line POs, approval states, partial receipts, rejected quantities, and variance tolerances.
- Store original invoice PDFs in private object storage and retain content hash, uploader, and timestamps.
- Extract invoice fields into a reviewable draft; never auto-post uncertain matches.
- Three-way match PO, receipt, and invoice at line level.
- Post accepted receipt quantities to the component ledger idempotently.

### Phase 5 — Fulfilment consumption, RTO QC, and manual sales

- Consume component allocations once on the first verified Shiprocket pickup event.
- Preserve status-event history so replays cannot consume stock twice.
- Add RTO QC decisions by component: reusable, damaged, or missing.
- Return reusable quantities through compensating ledger entries.
- Route manual/off-platform sales through the same recipe, allocation, and consumption rules.

### Phase 6 — Permissions, audit, and operational reporting

- Enforce ADMIN, MANAGER, OPERATIONS, CONFIRMATION_AGENT, WAREHOUSE, and VIEWER permissions on every server mutation.
- Add approval boundaries for high-risk adjustments, PO changes, and receipt reversals.
- Expose immutable audit trails, stock-card views, PO ageing, supplier variances, and reconciliation exceptions.
- Add precomputed summaries only after the source-of-truth calculations are verified.

### Phase 7 — Production acceptance

- Backfill and reconcile catalogues, recipes, opening balances, open orders, and open POs.
- Compare a sampled set of Shopify products, supplier documents, Shiprocket events, and ledger movements end to end.
- Test retries, duplicate webhooks, partial receipts, cancellations, RTO recovery, and role restrictions.
- Release progressively in WordSell production with monitoring and a reversible feature flag.

## Phase 1 acceptance checks

- No Shopify secret exists in committed files or client bundles.
- Catalogue pagination includes products with more than 100 variants and marks records absent from a completed sync inactive.
- Invalid, negative, or missing quantities are rejected rather than converted to zero.
- A manual quantity change has a mandatory reason, append-only ledger delta, actor identity, and before/after audit record.
- Inventory headline cards count entities instead of adding incompatible units.
- Product and open-PO counts are calculated independently of UI row limits.
- The existing WordSell dashboard builds and its analytics/OFD/auth regression checks continue to pass.

