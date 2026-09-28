import fs from "fs";
import readline from "readline";
import { getRuntimeEnv } from "../lib/database";
import { loadOfdRecords } from "../lib/ofd";

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

function cleanNum(val: unknown): number {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function normalizeDate(str: string): string {
  const s = cleanStr(str);
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.replace(" ", "T") + (s.includes("+") || s.includes("Z") ? "" : "+05:30");
  }
  return s;
}

export async function reconcileSourceOfTruth() {
  console.log("=== STARTING RECONCILIATION FROM SOURCE OF TRUTH CSV ===");
  const csvPath = "report/secure_9341191_reports_1790575633890111120-c7b025a55516361c509e389fc7ca23ca-.csv";
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found at: ${csvPath}`);
  }

  const fileStream = fs.createReadStream(csvPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let header: string[] = [];
  const headerMap = new Map<string, number>();
  const ordersMap = new Map<
    string,
    {
      orderId: string;
      status: string;
      orderDate: string;
      shippedAt: string;
      deliveredAt: string;
      firstOfdAt: string;
      outForDeliveryAt: string;
      ndrAttempts: number;
      ndrReason: string;
      ndrRaisedAt: string;
      awb: string;
      courier: string;
      total: number;
      shippingCost: number;
      city: string;
      state: string;
      paymentMethod: string;
    }
  >();

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) {
      header = parseCsvLine(line).map((h) => h.trim());
      header.forEach((h, i) => headerMap.set(h, i));
      continue;
    }
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const channel = cleanStr(cols[headerMap.get("Channel")!]);
    if (channel !== "Shopify_5") continue;

    const oid = cleanStr(cols[headerMap.get("Order ID")!]);
    if (!oid) continue;

    if (!ordersMap.has(oid)) {
      ordersMap.set(oid, {
        orderId: oid,
        status: cleanStr(cols[headerMap.get("Status")!]),
        orderDate: normalizeDate(cols[headerMap.get("Channel Created At")!] || cols[headerMap.get("Shiprocket Created At")!]),
        shippedAt: normalizeDate(cols[headerMap.get("Order Shipped Date")!]),
        deliveredAt: normalizeDate(cols[headerMap.get("Order Delivered Date")!]),
        firstOfdAt: normalizeDate(cols[headerMap.get("First Out For Delivery Date")!]),
        outForDeliveryAt: normalizeDate(cols[headerMap.get("Latest OFD Date")!]),
        ndrAttempts: Math.round(cleanNum(cols[headerMap.get("Attempt Count")!])),
        ndrReason: cleanStr(cols[headerMap.get("Latest NDR Reason")!]),
        ndrRaisedAt: normalizeDate(cols[headerMap.get("Latest NDR Date")!]),
        awb: cleanStr(cols[headerMap.get("AWB Code")!]),
        courier: cleanStr(cols[headerMap.get("Courier Company")!]),
        total: cleanNum(cols[headerMap.get("Order Total")!]),
        shippingCost: cleanNum(cols[headerMap.get("Freight Total Amount")!]) || cleanNum(cols[headerMap.get("Shipping Charges")!]),
        city: cleanStr(cols[headerMap.get("Address City")!]),
        state: cleanStr(cols[headerMap.get("Address State")!]),
        paymentMethod: cleanStr(cols[headerMap.get("Payment Method")!]).toLowerCase(),
      });
    }
  }

  console.log(`Parsed ${ordersMap.size} unique Shopify_5 orders from CSV. Performing database sync in chunks...`);

  const runtime = getRuntimeEnv();
  const db = runtime.DB;

  // Make sure analytics_cache table exists
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS analytics_cache (
      cache_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).run().catch(() => null);

  const ordersList = Array.from(ordersMap.values());
  const chunkSize = 250;
  let updatedCount = 0;

  for (let i = 0; i < ordersList.length; i += chunkSize) {
    const chunk = ordersList.slice(i, i + chunkSize);
    const ids = chunk.map((o) => o.orderId);
    const statuses = chunk.map((o) => o.status);
    const deliveredAts = chunk.map((o) => o.deliveredAt);
    const shippedAts = chunk.map((o) => o.shippedAt);
    const ofdAts = chunk.map((o) => o.outForDeliveryAt);
    const firstOfdAts = chunk.map((o) => o.firstOfdAt);
    const ndrAttempts = chunk.map((o) => o.ndrAttempts);
    const ndrReasons = chunk.map((o) => o.ndrReason);
    const ndrDates = chunk.map((o) => o.ndrRaisedAt);
    const awbs = chunk.map((o) => o.awb);
    const couriers = chunk.map((o) => o.courier);
    const totals = chunk.map((o) => o.total);
    const shippingCosts = chunk.map((o) => o.shippingCost);
    const cities = chunk.map((o) => o.city);
    const states = chunk.map((o) => o.state);
    const paymentMethods = chunk.map((o) => o.paymentMethod);

    await db.prepare(`
      UPDATE orders
      SET
        status = u.st,
        delivered_at = CASE WHEN u.del != '' THEN u.del ELSE orders.delivered_at END,
        shipped_at = CASE WHEN u.shp != '' THEN u.shp ELSE orders.shipped_at END,
        out_for_delivery_at = CASE WHEN u.ofd != '' THEN u.ofd ELSE orders.out_for_delivery_at END,
        first_out_for_delivery_at = CASE WHEN u.fofd != '' THEN u.fofd ELSE orders.first_out_for_delivery_at END,
        ndr_attempts = u.att,
        ndr_reason = CASE WHEN u.rsn != '' THEN u.rsn ELSE orders.ndr_reason END,
        ndr_raised_at = CASE WHEN u.ndrd != '' THEN u.ndrd ELSE orders.ndr_raised_at END,
        awb = CASE WHEN u.awb_val != '' THEN u.awb_val ELSE orders.awb END,
        courier = CASE WHEN u.cr != '' THEN u.cr ELSE orders.courier END,
        total = CASE WHEN u.tot > 0 THEN u.tot ELSE orders.total END,
        shipping_cost = CASE WHEN u.sc > 0 THEN u.sc ELSE orders.shipping_cost END,
        customer_city = CASE WHEN u.ct != '' THEN u.ct ELSE orders.customer_city END,
        customer_state = CASE WHEN u.stt != '' THEN u.stt ELSE orders.customer_state END,
        payment_method = CASE WHEN u.pm != '' THEN u.pm ELSE orders.payment_method END,
        synced_at = NOW()
      FROM (
        SELECT * FROM UNNEST(
          ?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[],
          ?::int[], ?::text[], ?::text[], ?::text[], ?::text[], ?::real[],
          ?::real[], ?::text[], ?::text[], ?::text[]
        ) AS t(id, st, del, shp, ofd, fofd, att, rsn, ndrd, awb_val, cr, tot, sc, ct, stt, pm)
      ) u
      WHERE orders.channel_order_id = u.id
    `).bind(
      ids, statuses, deliveredAts, shippedAts, ofdAts, firstOfdAts,
      ndrAttempts, ndrReasons, ndrDates, awbs, couriers, totals,
      shippingCosts, cities, states, paymentMethods
    ).run();

    updatedCount += chunk.length;
    console.log(`Synced ${updatedCount}/${ordersList.length} orders...`);
  }

  console.log("=== ORDERS UPDATED SUCCESSFULLY. NOW PRECOMPUTING CACHE IN DATABASE ===");

  // Clear stale analytics_cache entries so fresh metrics are loaded
  await db.prepare("TRUNCATE TABLE analytics_cache").run().catch(() => null);

  // Precompute and store Today's OFD in database cache
  const todayStr = "2026-09-28";
  const ofdRows = await loadOfdRecords(db, todayStr);
  console.log(`Precomputed Today's OFD (${ofdRows.results.length} records).`);

  console.log("=== RECONCILIATION AND CACHING COMPLETE ===");
}

if (process.argv[1]?.endsWith("reconcile-source-of-truth.ts")) {
  reconcileSourceOfTruth()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Reconciliation failed:", err);
      process.exit(1);
    });
}
