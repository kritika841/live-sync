import { getRuntimeEnv } from "../lib/database";
(async () => {
  const db = getRuntimeEnv().DB;
  await db.prepare("DELETE FROM ofd_ledger WHERE ofd_date='2026-10-13' AND source='live' AND order_id=1635384211").run();
  await db.prepare("DELETE FROM analytics_cache WHERE cache_key LIKE 'today_ofd_%'").run();
  const c = await db.prepare("SELECT COUNT(*) c FROM ofd_ledger WHERE ofd_date='2026-10-13'").first();
  console.log(JSON.stringify(c));
  process.exit(0);
})();
