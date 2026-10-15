import { getRuntimeEnv } from "../lib/database";

async function main() {
  const db = getRuntimeEnv().DB;
  const ids = ["SI0723227","SI0723138","SI0723029","SI0722999","SI0722894","SI0722876","SI0723152","SI0722716","SI0719844"];
  for (const id of ids) {
    const r = await db.prepare("SELECT id, channel_order_id, awb, status, first_out_for_delivery_at, out_for_delivery_at, delivered_at, ndr_attempts, attempt_count, updated_at FROM orders WHERE channel_order_id = ?").bind(id).first();
    console.log(id, JSON.stringify(r));
  }
  const cnt = await db.prepare("SELECT COUNT(*) c, MAX(updated_at) m FROM orders").first();
  console.log("orders", JSON.stringify(cnt));
  const ev = await db.prepare("SELECT status, event_at, received_at FROM webhook_events WHERE channel_order_id = ? ORDER BY id").bind("SI0723227").all();
  console.log(JSON.stringify(ev.results));
  process.exit(0);
}
main();
