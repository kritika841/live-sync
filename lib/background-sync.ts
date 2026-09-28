import { getRuntimeEnv } from "./database";
import { syncRecentOrders } from "./shiprocket";
import { invalidateCache } from "./server-cache";

declare global {
  var __satmi_background_sync_timer: NodeJS.Timeout | undefined;
  var __satmi_background_sync_running: boolean | undefined;
}

export function startBackgroundSync() {
  if (globalThis.__satmi_background_sync_timer) {
    return;
  }

  const runSync = async () => {
    if (globalThis.__satmi_background_sync_running) {
      return;
    }
    globalThis.__satmi_background_sync_running = true;
    try {
      const runtime = getRuntimeEnv();
      const res = await syncRecentOrders(runtime);
      invalidateCache("order-grouped-counts-30");
      invalidateCache("order-grouped-counts-60");
      invalidateCache("order-grouped-counts-90");
      if (process.env.NODE_ENV !== "production") {
        console.log(`[background-sync] Periodic 1m sync completed at ${new Date().toISOString()}:`, res);
      }
    } catch (error) {
      console.error("[background-sync] Periodic sync error:", error instanceof Error ? error.message : error);
    } finally {
      globalThis.__satmi_background_sync_running = false;
    }
  };

  // Run initial sync after 3 seconds, then every 60 seconds (1 minute) for recent orders
  const initialTimeout = setTimeout(() => {
    void runSync();
  }, 3000);

  globalThis.__satmi_background_sync_timer = setInterval(() => {
    void runSync();
  }, 60000);

  // 30-minute comprehensive sync to refresh logistics statuses and precompute cache
  const run30mSync = async () => {
    try {
      const runtime = getRuntimeEnv();
      const { syncShiprocketOrders } = await import("./shiprocket");
      const { loadOfdRecords } = await import("./ofd");
      console.log(`[background-sync] Running scheduled 30m comprehensive sync...`);
      await syncShiprocketOrders(runtime, "incremental", "daemon-30m");
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      await loadOfdRecords(runtime.DB, todayStr);
      console.log(`[background-sync] 30m sync completed and cache refreshed.`);
    } catch (err) {
      console.error("[background-sync] 30m sync error:", err instanceof Error ? err.message : err);
    }
  };

  // Run first 30m sync after 20 seconds, then every 30 minutes
  const initial30mTimeout = setTimeout(() => {
    void run30mSync();
  }, 20000);

  const timer30m = setInterval(() => {
    void run30mSync();
  }, 30 * 60 * 1000);

  // Avoid keeping test runners alive
  if (initialTimeout.unref) initialTimeout.unref();
  if (initial30mTimeout.unref) initial30mTimeout.unref();
  if (globalThis.__satmi_background_sync_timer.unref) globalThis.__satmi_background_sync_timer.unref();
  if (timer30m.unref) timer30m.unref();

  console.log(`[background-sync] Live order sync daemon initialized (every 60s & 30m).`);
}
