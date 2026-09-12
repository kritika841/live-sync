# August 2026 Shiprocket report audit

Source: the supplied Shiprocket CSV export for Channel Created At 1–31 August 2026.

The export contains 9,711 product rows representing 3,272 unique orders. Status
calculations must deduplicate by `Order ID` before counting; counting rows would
triple-count multi-line orders and falsely report 7,440 deliveries.

| Measure | Unique orders | Rate |
| --- | ---: | ---: |
| Delivered | 2,394 | 77.05% of attempted outcomes |
| Attempted outcomes | 3,107 | — |
| Shipped population | 3,121 | 76.71% delivered |
| All August orders | 3,272 | — |

Attempted outcomes include delivered, RTO, undelivered/NDR, and out-for-delivery
statuses. The shipped population adds in-transit, reached-destination-hub, and
lost orders, while excluding new orders and pickup exceptions. This uses the
same status definitions as `lib/analytics-status.ts`.

The supplied export is newer than the recorded walkthrough, whose comparison
was 2,392 delivered / 3,105 attempted / 3,118 shipped. The export therefore
reflects two additional delivered and attempted outcomes and three additional
shipped-population orders. The dashboard must be checked against the dated CSV
or against a Shiprocket snapshot taken at the same time; historical statuses
continue to change after an order is created.

No customer names, addresses, contact details, AWBs, or order identifiers are
stored in this audit document.
