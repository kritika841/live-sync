import { getRuntimeEnv } from "./database";
import { syncRecentOrders } from "./shiprocket";
import { invalidateCache } from "./server-cache";

declare global {
  var __satmi_background_sync_timer: NodeJS.Timeout | undefined;
  var __satmi_background_sync_running: boolean | undefined;
}

export function startBackgroundSync() {
  if (process.env.DISABLE_IN_APP_SYNC === "true") {
    console.log("[background-sync] In-app background sync is disabled (handled by external scheduler).");
    return;
  }

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
        console.log(`[background-sync] Periodic 15m sync completed at ${new Date().toISOString()}:`, res);
      }
    } catch (error) {
      console.error("[background-sync] Periodic sync error:", error instanceof Error ? error.message : error);
    } finally {
      globalThis.__satmi_background_sync_running = false;
    }
  };

  // Run initial sync after 15 seconds, then every 15 minutes for recent orders
  const initialTimeout = setTimeout(() => {
    void runSync();
  }, 15000);

  globalThis.__satmi_background_sync_timer = setInterval(() => {
    void runSync();
  }, 15 * 60 * 1000);

  // 3-hour comprehensive sync to refresh logistics statuses and precompute cache
  const run3hSync = async () => {
    try {
      const runtime = getRuntimeEnv();
      const { syncShiprocketOrders } = await import("./shiprocket");
      const { loadOfdRecords } = await import("./ofd");
      console.log(`[background-sync] Running scheduled 3h comprehensive sync...`);
      await syncShiprocketOrders(runtime, "incremental", "daemon-3h");
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      await loadOfdRecords(runtime.DB, todayStr);
      console.log(`[background-sync] 3h sync completed and cache refreshed.`);
    } catch (err) {
      console.error("[background-sync] 3h sync error:", err instanceof Error ? err.message : err);
    }
  };

  // Run first 3h sync after 2 minutes, then every 3 hours
  const initial3hTimeout = setTimeout(() => {
    void run3hSync();
  }, 120000);

  const timer3h = setInterval(() => {
    void run3hSync();
  }, 3 * 60 * 60 * 1000);

  // Avoid keeping test runners alive
  if (initialTimeout.unref) initialTimeout.unref();
  if (initial3hTimeout.unref) initial3hTimeout.unref();
  if (globalThis.__satmi_background_sync_timer.unref) globalThis.__satmi_background_sync_timer.unref();
  if (timer3h.unref) timer3h.unref();

  console.log(`[background-sync] Live order sync daemon initialized (every 15m & 3h).`);
}
