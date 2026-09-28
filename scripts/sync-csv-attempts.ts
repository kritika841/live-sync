import { getRuntimeEnv } from "../lib/database";
import fs from "fs";

async function main() {
  const db = getRuntimeEnv().DB;
  const data: Array<{
    oid: string;
    att: number;
    ndr_attempts: number;
    fofd: string;
    lofd: string;
    ndr_reason: string;
    courier: string;
    status: string;
  }> = JSON.parse(fs.readFileSync("scratch/accurate_csv_data.json", "utf8"));

  console.log(`Loaded ${data.length} clean orders to sync.`);

  let updated = 0;
  for (let i = 0; i < data.length; i += 500) {
    const chunk = data.slice(i, i + 500);
    const ids = chunk.map((u) => u.oid);
    const attempts = chunk.map((u) => u.ndr_attempts);
    const reasons = chunk.map((u) => u.ndr_reason);
    const fofds = chunk.map((u) => u.fofd);
    const lofds = chunk.map((u) => u.lofd);

    await db
      .prepare(`
      UPDATE orders
      SET 
        ndr_attempts = u.attempts,
        ndr_reason = CASE WHEN u.reason != '' THEN u.reason ELSE orders.ndr_reason END,
        first_out_for_delivery_at = CASE WHEN u.fofd != '' THEN u.fofd ELSE orders.first_out_for_delivery_at END,
        out_for_delivery_at = CASE WHEN u.lofd != '' THEN u.lofd ELSE orders.out_for_delivery_at END
      FROM (
        SELECT * FROM UNNEST(?::text[], ?::int[], ?::text[], ?::text[], ?::text[]) AS t(order_id, attempts, reason, fofd, lofd)
      ) u
      WHERE orders.channel_order_id = u.order_id
    `)
      .bind(ids, attempts, reasons, fofds, lofds)
      .run();

    updated += chunk.length;
    console.log(`Updated ${updated}/${data.length} orders...`);
  }

  console.log(`Finished updating all ${updated} orders in database.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
