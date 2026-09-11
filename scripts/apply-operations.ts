import { operationsDb } from "../lib/operations/schema";
try {
  const db = await operationsDb();
  const { results } = await db
    .prepare(
      "SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('app_schema_migrations','purchase_orders','goods_receipts','supplier_invoices','support_tickets','support_messages') ORDER BY tablename",
    )
    .all();
  console.log(JSON.stringify({ ok: true, security: results }));
} catch (e) {
  console.error(
    "Could not apply operations schema:",
    e instanceof Error ? e.message : "Database unavailable",
  );
  process.exitCode = 1;
}
