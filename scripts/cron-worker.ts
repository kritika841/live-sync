import { getRuntimeEnv } from "../lib/database";
import { syncShiprocketOrders, syncRecentOrders } from "../lib/shiprocket";
import { loadOfdRecords } from "../lib/ofd";
import { invalidateCache } from "../lib/server-cache";

async function executeSync(source = "cron") {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Starting scheduled 30-minute synchronization (source: ${source})...`);
  const runtime = getRuntimeEnv();

  try {
    // 1. Run incremental sync to fetch new and updated orders
    const result = await syncShiprocketOrders(runtime, "incremental", `vps-${source}`);
    console.log(`[${new Date().toISOString()}] Orders synchronized: ${result.synced} checked, status: ${result.mode}`);

    // 2. Clear stale cache in memory and database
    invalidateCache();

    // 3. Precompute and persist Today's OFD in PostgreSQL analytics_cache
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const ofdResult = await loadOfdRecords(runtime.DB, todayStr);
    console.log(`[${new Date().toISOString()}] Precomputed Today's OFD: ${ofdResult.results.length} records cached.`);

    // 4. Invalidate 30-day analytics cache key so next visit instantly picks fresh metrics
    await runtime.DB.prepare(
      "DELETE FROM analytics_cache WHERE cache_key LIKE 'today_ofd_%' OR updated_at < NOW() - INTERVAL '30 minutes'"
    ).run().catch(() => null);

    console.log(`[${new Date().toISOString()}] Synchronization and cache refresh complete!`);
    return { success: true, synced: result.synced };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Synchronization failed:`, error instanceof Error ? error.message : error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const isDaemon = process.argv.includes("--daemon");

  if (!isDaemon) {
    // Single execution (for crontab)
    const res = await executeSync("crontab");
    process.exit(res.success ? 0 : 1);
  }

  // Daemon mode (for PM2 or systemd)
  console.log(`[${new Date().toISOString()}] Satmi VPS sync daemon started. Running every 30 minutes.`);
  // Run immediately on start
  await executeSync("daemon-start");

  const THIRTY_MINUTES_MS = 30 * 60 * 1000;
  setInterval(async () => {
    await executeSync("daemon-tick");
  }, THIRTY_MINUTES_MS);
}

main().catch((err) => {
  console.error("Fatal error in sync worker:", err);
  process.exit(1);
});
