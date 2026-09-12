import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("ships the requested dark order dashboard without sample data", async () => {
  const [dashboard, styles, page] = await Promise.all([
    readFile(new URL("../app/OrdersDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  for (const label of ["New", "Ready to ship", "Shipped", "Delivered", "RTO", "All"]) {
    assert.match(dashboard, new RegExp(`label: "${label}"`));
  }
  assert.match(styles, /--bg:#080D13/i);
  assert.match(styles, /color-scheme:dark/);
  assert.match(styles, /\.view-hidden \{ display:none !important; \}/);
  assert.doesNotMatch(dashboard, /previewOrders|Ananya Mehta|Rohan Kapoor|Ishita Shah|stats-row/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
});

test("includes live sync, persistence, webhook, and scheduled reconciliation surfaces", async () => {
  const [sync, scheduledSync, hosting] = await Promise.all([
    readFile(new URL("../lib/shiprocket.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(sync, /apiv2\.shiprocket\.in\/v1\/external/);
  assert.match(sync, /channel_id/);
  assert.match(scheduledSync, /syncShiprocketOrders/);
  assert.match(hosting, /"d1": "DB"/);
  await Promise.all([
    access(new URL("../app/api/orders/route.ts", import.meta.url)),
    access(new URL("../app/api/sync/route.ts", import.meta.url)),
    access(new URL("../app/api/webhooks/shiprocket/route.ts", import.meta.url)),
    access(new URL("../app/api/webhooks/tracking/route.ts", import.meta.url)),
    access(new URL("../app/api/logs/route.ts", import.meta.url)),
    access(new URL("../app/api/analytics/route.ts", import.meta.url)),
    access(new URL("../app/api/reports/route.ts", import.meta.url)),
    access(new URL("../drizzle/0000_violet_boom_boom.sql", import.meta.url)),
  ]);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("includes live analytics and today's out-for-delivery tracking", async () => {
  const [dashboard, analytics, apiRoute, database, sync, ofd] = await Promise.all([
    readFile(new URL("../app/OrdersDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AnalyticsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analytics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/shiprocket.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ofd.ts", import.meta.url), "utf8"),
  ]);
  const api=apiRoute+ofd;
  assert.match(dashboard, />Analytics</);
  assert.match(dashboard, />Today’s OFD</);
  assert.match(analytics, /Delivery % by courier/);
  assert.match(analytics, /Delivered ÷ \(Delivered \+ RTO \+ Undelivered \+ OFD\) × 100/);
  assert.match(analytics, /Delivered ÷ \(All shipped statuses\) × 100/);
  assert.match(analytics, /Includes RTO, undelivered and lost/);
  assert.match(analytics, /NDR reasons/);
  assert.match(analytics, /Previously undelivered/);
  assert.match(analytics, /1st recorded OFD day/);
  assert.match(analytics, /2nd recorded OFD day/);
  assert.match(analytics, /3rd recorded OFD day/);
  assert.match(analytics, /Unresolved after OFD/);
  assert.match(analytics, /Filter OFD outcomes/);
  assert.match(api, /out_for_delivery_at/);
  assert.match(api, /loadOfdRecords/);
  assert.match(api, /event_at/);
  assert.match(api, /openPopulationSql/);
  assert.match(api, /UNRESOLVED AFTER OFD/);
  assert.match(api, /deliveredRevenue/);
  assert.match(api, /deliveredShippingCostCount/);
  assert.match(api, /Order date in Asia\/Kolkata/);
  assert.match(analytics, /real orders in this view/);
  for (const alias of ["deliveredrevenue", "avgshippingcost", "avgdeliveredordervalue", "openpopulation", "latestknownstatus"]) {
    assert.match(database, new RegExp(`${alias}:`));
  }
  assert.match(sync, /order\.sub_total/);
  assert.match(sync, /courier\/track\/awbs/);
  assert.match(sync, /shipment_track_activities/);
  assert.match(sync, /tracking_backfill_before_id/);
  assert.match(api, /first_out_for_delivery_at/);
  assert.match(api, /ndr_reason/);
  assert.match(dashboard, />Reports</);
  const [reports, workbook] = await Promise.all([
    readFile(new URL("../app/ReportsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/excel-report.ts", import.meta.url), "utf8"),
  ]);
  assert.match(reports, /Reconciliation history/);
  assert.match(reports, /Download Excel/);
  assert.match(reports, /Sync discrepancy table/);
  assert.match(workbook, /Discrepancies by Field/);
  assert.match(workbook, /Affected Orders/);
  assert.doesNotMatch(dashboard, /What changed during sync/);
  assert.match(sync, /\/ndr\/all/);
  assert.match(sync, /discrepanciesTotal/);
});

test("shows confirmation contact numbers by default and supports contact filtering", async () => {
  const [confirmation, api] = await Promise.all([
    readFile(new URL("../app/ConfirmationPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/confirmation/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(confirmation, /href={`tel:\${order\.customerPhone}`}/);
  assert.match(confirmation, /Filter by customer, contact number, order, city or state/);
  assert.match(confirmation, /customerPhone\?\.replace/);
  assert.match(api, /customer_phone AS customerPhone/);
  assert.doesNotMatch(confirmation, /reveal|masked/i);
});

test("keeps the sign-in action high contrast", async () => {
  const [signIn, styles] = await Promise.all([
    readFile(new URL("../app/auth/SignInForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(signIn, /button type="submit"/);
  assert.match(styles, /\.standalone-signin button \{[^}]*background:linear-gradient/);
  assert.match(styles, /\.standalone-signin button \{[^}]*color:#06110C/);
  assert.doesNotMatch(styles, /\.standalone-signin button \{[^}]*var\(--accent\)/);
});

test("includes the auditable inventory foundation without embedded Shopify secrets", async () => {
  const [dashboard, panel, api, database, shopify, exampleEnv, plan] = await Promise.all([
    readFile(new URL("../app/OrdersDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/InventoryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/shopify.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../docs/inventory-implementation-plan.md", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, />Inventory</);
  assert.match(panel, /Physical/);
  assert.match(panel, /require a reason/i);
  assert.match(panel, /Sync Shopify products/);
  assert.match(api, /mutateInventory/);
  assert.match(api, /errorResponse/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS component_ledger/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS supplier_invoices/);
  assert.match(shopify, /variants\(first: 100, after: \$cursor\)/);
  assert.match(shopify, /UPDATE inventory_products SET active=FALSE/);
  assert.match(exampleEnv, /SHOPIFY_ADMIN_ACCESS_TOKEN=\s*$/m);
  assert.doesNotMatch([dashboard, panel, api, database, shopify, exampleEnv, plan].join("\n"), /shpat_|shpss_/);
});
