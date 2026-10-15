import { getRuntimeEnv } from "../lib/database";
(async () => {
  const db = getRuntimeEnv().DB;
  const r = await db.prepare("SELECT id, ofd_date, order_id, source FROM ofd_ledger WHERE ofd_date = ?").bind("2026-02-06").all<any>();
  console.log(r.results);
  await db.prepare("DELETE FROM ofd_ledger WHERE ofd_date = ?").bind("2026-02-06").run();
  console.log("deleted");
  process.exit(0);
})();
