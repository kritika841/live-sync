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
  assert.match(styles, /--bg:#080b0a/);
  assert.match(styles, /color-scheme:dark/);
  assert.match(styles, /\.view-hidden \{ display:none !important; \}/);
  assert.doesNotMatch(dashboard, /previewOrders|Ananya Mehta|Rohan Kapoor|Ishita Shah|stats-row/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
});

test("includes live sync, persistence, webhook, and daily reconciliation surfaces", async () => {
  const [sync, worker, hosting] = await Promise.all([
    readFile(new URL("../lib/shiprocket.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(sync, /apiv2\.shiprocket\.in\/v1\/external/);
  assert.match(sync, /channel_id/);
  assert.match(worker, /scheduled/);
  assert.match(hosting, /"d1": "DB"/);
  await Promise.all([
    access(new URL("../app/api/orders/route.ts", import.meta.url)),
    access(new URL("../app/api/sync/route.ts", import.meta.url)),
    access(new URL("../app/api/webhooks/shiprocket/route.ts", import.meta.url)),
    access(new URL("../app/api/webhooks/tracking/route.ts", import.meta.url)),
    access(new URL("../app/api/logs/route.ts", import.meta.url)),
    access(new URL("../app/api/analytics/route.ts", import.meta.url)),
    access(new URL("../drizzle/0000_violet_boom_boom.sql", import.meta.url)),
  ]);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("includes live analytics and today's out-for-delivery tracking", async () => {
  const [dashboard, analytics, api] = await Promise.all([
    readFile(new URL("../app/OrdersDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AnalyticsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analytics/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, />Analytics</);
  assert.match(dashboard, />Today’s OFD</);
  assert.match(analytics, /Delivery % by courier/);
  assert.match(analytics, /Delivered ÷ \(Delivered \+ RTO \+ Undelivered\) × 100/);
  assert.match(analytics, /Delivered ÷ all shipped orders × 100/);
  assert.match(analytics, /NDR reasons/);
  assert.match(analytics, /Previously undelivered/);
  assert.match(api, /out_for_delivery_at/);
  assert.match(api, /deliveredRevenue/);
  assert.match(api, /first_out_for_delivery_at/);
  assert.match(api, /ndr_reason/);
  assert.match(dashboard, /What changed during sync/);
  const sync = await readFile(new URL("../lib/shiprocket.ts", import.meta.url), "utf8");
  assert.match(sync, /\/ndr\/all/);
  assert.match(sync, /discrepanciesTotal/);
});
