import { operationsDb } from "./schema";
import { mutateInventory } from "./inventory";
import { HttpError } from "../http";
import { getRuntimeEnv, logActivity } from "../database";
const system = {
  id: "inventory-sync",
  email: "system",
  name: "Inventory sync",
  role: "admin",
};
// Only verified Shiprocket writes trigger automatic consumption.
export async function reconcileInventory(orderIds?: number[]) {
  const db = await operationsDb();
  // With no recipes or prior allocations, there is no stock operation to perform.
  const configured=await db.prepare("SELECT EXISTS(SELECT 1 FROM recipe_items) OR EXISTS(SELECT 1 FROM inventory_order_allocations) AS ready").first<{ready:boolean}>();
  if(!configured?.ready)return;
  const orders = await db.transaction(async (sql) =>
    orderIds?.length
      ? await sql`SELECT id,status,shipped_at FROM orders WHERE id IN ${sql(orderIds)} ORDER BY created_at,id`
      : await sql`SELECT o.id,o.status,o.shipped_at FROM orders o WHERE EXISTS(SELECT 1 FROM inventory_order_allocations a WHERE a.order_id=o.id AND a.state='reserved') ORDER BY o.created_at,o.id LIMIT 500`,
  );
  const statesResult = orders.length
    ? await db.prepare(`SELECT order_id AS orderId, state FROM inventory_order_allocations WHERE order_id IN (${orders.map(() => "?").join(",")})`).bind(...orders.map((o) => o.id)).all<{ orderId: number; state: string }>()
    : { results: [] };
  const stateByOrder = new Map(statesResult.results.map((r) => [Number(r.orderId), r.state]));
  for (const o of orders) {
    const state = stateByOrder.get(Number(o.id));
    try {
      if (/cancel/i.test(o.status)) {
        if (state === "reserved")
          await mutateInventory(
            {
              action: "release",
              orderId: o.id,
              reason: "Verified cancellation from Shiprocket",
            },
            system,
          );
        continue;
      }
      if (!state && !/rto|delivered/i.test(o.status))
        await mutateInventory({ action: "reserve", orderId: o.id }, system);
      if (
        o.shipped_at ||
        /^(picked up|shipped|in transit|out for delivery|delivered)$/i.test(
          o.status,
        )
      )
        await mutateInventory(
          {
            action: "consume",
            orderId: o.id,
            reason: "Verified fulfilment from Shiprocket",
          },
          system,
        );
    } catch (e) {
      if (!(e instanceof HttpError && [400, 409].includes(e.status))) throw e;
    }
  }
}
export async function reconcileInventorySafely(orderIds?: number[]) {
  try {
    await reconcileInventory(orderIds);
  } catch {
    await logActivity(
      getRuntimeEnv().DB,
      "Inventory",
      "inventory.reconciliation_failed",
      "Inventory reconciliation needs attention. Orders remain synchronized.",
      {},
      "error",
    ).catch(() => {});
  }
}
