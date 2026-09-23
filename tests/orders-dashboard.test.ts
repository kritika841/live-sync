import test from "node:test";
import assert from "node:assert/strict";
import { sqlForDashboardTab, sqlForTab } from "../lib/order-status";

test("the dashboard New queue includes the persistent unshipped status queue", () => {
  const sql = sqlForDashboardTab("new");
  assert.ok(sql.includes("UPPER(TRIM(status)) IN ('NEW'"));
  assert.equal(sql, sqlForTab("new"));
});

test("historical dashboard status tabs retain their existing status filters", () => {
  for (const tab of ["ready", "shipped", "out_for_delivery", "undelivered", "delivered", "rto", "all"] as const) {
    assert.equal(sqlForDashboardTab(tab), sqlForTab(tab));
  }
});
