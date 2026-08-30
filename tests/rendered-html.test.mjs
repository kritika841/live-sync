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
    access(new URL("../drizzle/0000_violet_boom_boom.sql", import.meta.url)),
  ]);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
