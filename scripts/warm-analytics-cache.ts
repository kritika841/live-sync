import { getRuntimeEnv } from "../lib/database";

async function warm() {
  console.log("=== WARMING DATABASE ANALYTICS CACHE ===");
  const runtime = getRuntimeEnv();

  // Test fetch local route or call directly
  const baseUrl = "http://localhost:3000";
  const urls = [
    `${baseUrl}/api/analytics?mode=today_ofd&date=2026-09-28&refresh=1`,
    `${baseUrl}/api/analytics?from=2026-08-30&to=2026-09-28&refresh=1`,
    `${baseUrl}/api/analytics?from=2026-09-01&to=2026-09-28&refresh=1`,
    `${baseUrl}/api/analytics?from=2026-09-22&to=2026-09-28&refresh=1`,
    `${baseUrl}/api/analytics?from=2026-09-28&to=2026-09-28&refresh=1`,
  ];

  for (const url of urls) {
    console.time(url);
    try {
      const res = await fetch(url, { headers: { "x-requested-with": "satmi-analytics" } });
      console.log(`Status ${res.status} for ${url}`);
    } catch (e) {
      console.error(`Error warming ${url}:`, e);
    }
    console.timeEnd(url);
  }

  // Now verify database rows in analytics_cache
  const rows = await runtime.DB.prepare("SELECT cache_key, updated_at FROM analytics_cache").all();
  console.log("\nPersisted Database Cache Keys:");
  console.table(rows.results);
}

warm().catch(console.error);
