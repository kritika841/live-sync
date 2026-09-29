import postgres from "postgres";

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

const PREHISTORIC_RANGES = [
  { label: "August 2026 (last_month)", from: "2026-08-01", to: "2026-08-31" },
  { label: "July 2026", from: "2026-07-01", to: "2026-07-31" },
  { label: "June 2026", from: "2026-06-01", to: "2026-06-30" },
  { label: "May 2026", from: "2026-05-01", to: "2026-05-31" },
  { label: "April 2026", from: "2026-04-01", to: "2026-04-30" },
  { label: "March 2026", from: "2026-03-01", to: "2026-03-31" },
  { label: "February 2026", from: "2026-02-01", to: "2026-02-28" },
  { label: "January 2026", from: "2026-01-01", to: "2026-01-31" },
  { label: "All Prehistoric (Jan-Aug 2026)", from: "2026-01-01", to: "2026-08-30" },
];

const ACTIVE_PRESETS = [
  { label: "All Time (Lifetime)", url: `${BASE_URL}/api/analytics?refresh=1` },
  { label: "Last 30 Days", url: `${BASE_URL}/api/analytics?from=2026-08-30&to=2026-09-29&refresh=1` },
  { label: "Month-to-Date (September 2026)", url: `${BASE_URL}/api/analytics?from=2026-09-01&to=2026-09-29&refresh=1` },
  { label: "Today OFD", url: `${BASE_URL}/api/analytics?mode=today_ofd&date=2026-09-29&refresh=1` },
];

async function main() {
  console.log("================================================================================");
  console.log("       PRECOMPUTING AND SAVING PREHISTORIC ANALYTICS TO DATABASE                ");
  console.log("================================================================================\n");

  const sql = postgres(process.env.SUPABASE_DB_URL!);

  // 1. Precompute each prehistoric month
  for (const range of PREHISTORIC_RANGES) {
    const url = `${BASE_URL}/api/analytics?from=${range.from}&to=${range.to}&refresh=1`;
    console.log(`Precomputing [${range.label}] (${range.from} -> ${range.to})...`);
    console.time(`  Loaded in`);
    try {
      const res = await fetch(url, {
        headers: { "x-requested-with": "satmi-analytics" },
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`  Failed with status ${res.status}: ${text}`);
      } else {
        const json = await res.json();
        console.log(`  Success! Orders: ${json.metrics?.total?.count || 0}, Delivered: ${json.metrics?.delivered?.count || 0}, RTO: ${json.metrics?.rto?.count || 0}`);
      }
    } catch (e) {
      console.error(`  Error precomputing ${range.label}:`, (e as Error).message || e);
    }
    console.timeEnd(`  Loaded in`);
  }

  // 2. Precompute active presets
  console.log("\nPrecomputing Active Dashboard Presets...");
  for (const preset of ACTIVE_PRESETS) {
    console.log(`Warming [${preset.label}]...`);
    console.time(`  Loaded in`);
    try {
      const res = await fetch(preset.url, { headers: { "x-requested-with": "satmi-analytics" } });
      if (res.ok) {
        const json = await res.json();
        const total = json.metrics?.total?.count ?? json.todayOfd?.total ?? json.total ?? 0;
        console.log(`  Success! Total count: ${total}`);
      } else {
        console.error(`  Failed with status ${res.status}`);
      }
    } catch (e) {
      console.error(`  Error warming ${preset.label}:`, e);
    }
    console.timeEnd(`  Loaded in`);
  }

  // 3. Verify analytics_cache in the database
  console.log("\n=== DATABASE ANALYTICS CACHE VERIFICATION ===");
  const rows = await sql`
    SELECT 
      SUBSTR(cache_key, 1, 90) as cache_key_prefix,
      is_immutable,
      updated_at,
      pg_size_pretty(pg_column_size(payload)::bigint) as payload_size
    FROM analytics_cache
    ORDER BY is_immutable DESC, updated_at DESC
  `;
  console.table(rows);

  console.log(`\nTotal cached analytics payloads in database: ${rows.length}`);
  const immutableCount = rows.filter(r => r.is_immutable).length;
  console.log(`Permanent immutable prehistoric records: ${immutableCount}`);

  await sql.end();
}

main().catch(console.error);
