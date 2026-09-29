import fs from "fs";
import readline from "readline";
import { getRuntimeEnv } from "../lib/database";
import { statusTab } from "../lib/order-status";

function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function cleanStr(val: unknown): string {
  if (!val) return "";
  const s = String(val).replace(/^'+|'+$/g, "").trim();
  return s === "N/A" || s === "null" || s === "undefined" ? "" : s;
}

async function run() {
  const runtime = getRuntimeEnv();
  const csvPath = "report/secure_9341191_reports_1790661227409249824-fe1bcd8256ebe166bc7ffbef1e99c0f2-.csv";
  
  const fileStream = fs.createReadStream(csvPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const uniqueSheetOrders = new Map<string, { status: string; orderDate: string; channel: string }>();

  let totalCsvRows = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    totalCsvRows++;
    if (totalCsvRows === 1) {
      continue;
    }
    const cols = parseCsvLine(line);
    const orderId = cleanStr(cols[0]);
    const channel = cleanStr(cols[3]);
    const status = cleanStr(cols[4]);
    const orderDate = cleanStr(cols[10]);

    if (!orderId) continue;
    if (!uniqueSheetOrders.has(orderId)) {
      uniqueSheetOrders.set(orderId, { status, orderDate, channel });
    }
  }

  console.log(`CSV Rows: ${totalCsvRows}`);
  console.log(`Unique Orders in Sheet (Deduplicated): ${uniqueSheetOrders.size}`);

  // Fetch all orders from DB for Satmi (channel_id = '9574697')
  const dbOrders = await runtime.DB.prepare(`
    SELECT channel_order_id, status, order_date, created_at, channel_id, channel_name
    FROM orders
    WHERE channel_id = '9574697' OR channel_name ILIKE '%Shopify_5%'
  `).all<{ channel_order_id: string; status: string; order_date: string; created_at: string; channel_id: string; channel_name: string }>();

  console.log(`Total Orders in Database: ${dbOrders.results.length}`);

  const dbMap = new Map<string, { status: string; orderDate: string; createdAt: string }>();
  for (const r of dbOrders.results) {
    dbMap.set(r.channel_order_id.trim(), {
      status: r.status,
      orderDate: r.order_date || r.created_at || "",
      createdAt: r.created_at || ""
    });
  }

  // 1. Cross-matching IDs
  let inBoth = 0;
  const inSheetNotInDb: string[] = [];
  for (const [id] of uniqueSheetOrders.entries()) {
    if (dbMap.has(id)) inBoth++;
    else inSheetNotInDb.push(id);
  }

  const inDbNotInSheet: { id: string; date: string; status: string }[] = [];
  for (const [id, r] of dbMap.entries()) {
    if (!uniqueSheetOrders.has(id)) {
      inDbNotInSheet.push({ id, date: r.orderDate, status: r.status });
    }
  }

  console.log(`\n=== ORDER ID PARITY ===`);
  console.log(`Matching in both Sheet and DB: ${inBoth} / ${uniqueSheetOrders.size} (${((inBoth / uniqueSheetOrders.size) * 100).toFixed(2)}%)`);
  console.log(`In Sheet but missing in DB: ${inSheetNotInDb.length}`);
  console.log(`In DB but not in Sheet (e.g. earlier Jan 2026 or placed today): ${inDbNotInSheet.length}`);

  const dbNotSheetByMonth: Record<string, number> = {};
  for (const r of inDbNotInSheet) {
    const m = r.date.slice(0, 7) || "unknown";
    dbNotSheetByMonth[m] = (dbNotSheetByMonth[m] || 0) + 1;
  }
  console.log(`DB-only orders by month:`, dbNotSheetByMonth);

  // 2. Tab counts comparison
  // A) Deduplicated Sheet categorized into tabs
  const sheetTabCounts: Record<string, number> = {
    new: 0, ready: 0, shipped: 0, out_for_delivery: 0, undelivered: 0, delivered: 0, rto: 0, other: 0, total: 0
  };
  for (const [, o] of uniqueSheetOrders.entries()) {
    const bucket = statusTab(o.status);
    sheetTabCounts[bucket] = (sheetTabCounts[bucket] || 0) + 1;
    sheetTabCounts.total++;
  }

  // B) Database categorized into tabs (ALL orders)
  const dbAllTabCounts: Record<string, number> = {
    new: 0, ready: 0, shipped: 0, out_for_delivery: 0, undelivered: 0, delivered: 0, rto: 0, other: 0, total: 0
  };
  for (const [, o] of dbMap.entries()) {
    const bucket = statusTab(o.status);
    dbAllTabCounts[bucket] = (dbAllTabCounts[bucket] || 0) + 1;
    dbAllTabCounts.total++;
  }

  // C) Database categorized into tabs for EXACT 20,647 orders matching Sheet
  const dbMatchedTabCounts: Record<string, number> = {
    new: 0, ready: 0, shipped: 0, out_for_delivery: 0, undelivered: 0, delivered: 0, rto: 0, other: 0, total: 0
  };
  for (const [id] of uniqueSheetOrders.entries()) {
    const o = dbMap.get(id);
    if (!o) continue;
    const bucket = statusTab(o.status);
    dbMatchedTabCounts[bucket] = (dbMatchedTabCounts[bucket] || 0) + 1;
    dbMatchedTabCounts.total++;
  }

  // D) Dashboard UI tab counts (with 30-day cutoff on New)
  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let dbUiNewCount = 0;
  for (const [, o] of dbMap.entries()) {
    const bucket = statusTab(o.status);
    if (bucket === "new") {
      const d = o.orderDate.slice(0, 10);
      if (d >= cutoffDate) {
        dbUiNewCount++;
      }
    }
  }

  console.log(`\n=== TAB COMPARISON TABLE ===`);
  console.log(`Tab               | Deduplicated Sheet | DB (Matched 20,647) | DB (All ${dbOrders.results.length}) | DB UI Displayed`);
  console.log(`------------------------------------------------------------------------------------------------`);
  const tabsList = ["new", "ready", "shipped", "out_for_delivery", "undelivered", "delivered", "rto", "other", "total"];
  for (const t of tabsList) {
    const s = String(sheetTabCounts[t] ?? 0).padStart(18);
    const m = String(dbMatchedTabCounts[t] ?? 0).padStart(19);
    const a = String(dbAllTabCounts[t] ?? 0).padStart(14);
    const ui = t === "new" ? String(dbUiNewCount).padStart(16) : a.padStart(16);
    console.log(`${t.padEnd(17)} | ${s} | ${m} | ${a} | ${ui}`);
  }

  // 3. Status changes between Sheet and DB for the exact 20,647 matched orders
  const statusDiffs: Record<string, number> = {};
  for (const [id, sOrder] of uniqueSheetOrders.entries()) {
    const dbOrder = dbMap.get(id);
    if (!dbOrder) continue;
    const sStatus = sOrder.status.trim().toUpperCase();
    const dStatus = dbOrder.status.trim().toUpperCase();
    if (sStatus !== dStatus) {
      const key = `${sStatus} -> ${dStatus}`;
      statusDiffs[key] = (statusDiffs[key] || 0) + 1;
    }
  }

  console.log(`\n=== STATUS MOVEMENTS (Live Sync/Webhooks updating orders since CSV export) ===`);
  const sortedDiffs = Object.entries(statusDiffs).sort((a, b) => b[1] - a[1]);
  for (const [change, count] of sortedDiffs.slice(0, 15)) {
    console.log(`  ${change}: ${count} orders`);
  }

  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
