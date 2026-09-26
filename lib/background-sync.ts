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
      invalidateCache();
      if (process.env.NODE_ENV !== "production") {
        console.log(`[background-sync] Periodic 1m sync completed at ${new Date().toISOString()}:`, res);
      }
    } catch (error) {
      console.error("[background-sync] Periodic sync error:", error instanceof Error ? error.message : error);
    } finally {
      globalThis.__satmi_background_sync_running = false;
    }
  };

  // Run initial sync after 3 seconds, then every 60 seconds (1 minute)
  const initialTimeout = setTimeout(() => {
    void runSync();
  }, 3000);

  globalThis.__satmi_background_sync_timer = setInterval(() => {
    void runSync();
  }, 60000);

  // Avoid keeping test runners alive
  if (initialTimeout.unref) initialTimeout.unref();
  if (globalThis.__satmi_background_sync_timer.unref) globalThis.__satmi_background_sync_timer.unref();

  console.log(`[background-sync] Live order sync daemon initialized (every 60s).`);
}
