import { getRuntimeEnv } from "../lib/database";
(async () => {
  const db = getRuntimeEnv().DB;
  const r = await db.prepare("SELECT order_id, channel_order_id, source, closed, final_status, created_at FROM ofd_ledger WHERE ofd_date='2026-10-13' AND source <> 'csv'").all();
  console.log(JSON.stringify(r.results));
  const s = await db.prepare("SELECT ofd_date, source, COUNT(*) c FROM ofd_ledger GROUP BY 1,2 HAVING source <> 'csv'").all();
  console.log(JSON.stringify(s.results));
  process.exit(0);
})();
