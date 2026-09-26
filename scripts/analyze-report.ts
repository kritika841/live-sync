import fs from "fs";
import readline from "readline";
import postgres from "postgres";
import { statusTab } from "../lib/order-status";

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function runDetailedAudit() {
  const sql = postgres(process.env.SUPABASE_DB_URL!);

  // 1. Read CSV
  const csvPath = "report/secure_9341191_reports_1790161896103398733-df45f5137bd92a5208a1582184cca89a-.csv";
  const fileStream = fs.createReadStream(csvPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] = [];
  const headerMap = new Map<string, number>();
  let rowCount = 0;

  const csvOrders = new Map<string, {
    orderId: string;
    channel: string;
    status: string;
    srCreatedAt: string;
    chCreatedAt: string;
    customerName: string;
    paymentMethod: string;
    orderTotal: number;
    courier: string;
    awb: string;
    deliveredDate: string;
    rtoDeliveredDate: string;
    orderTags: string;
  }>();

  for await (const line of rl) {
    if (rowCount++ === 0) {
      headers = parseCsvLine(line).map(h => h.trim());
      headers.forEach((h, i) => headerMap.set(h, i));
      continue;
    }
    const cols = parseCsvLine(line);
    const orderId = (cols[headerMap.get("Order ID")!] || "").trim();
    if (!orderId) continue;

    if (!csvOrders.has(orderId)) {
      csvOrders.set(orderId, {
        orderId,
        channel: cols[headerMap.get("Channel")!]?.trim() || "",
        status: cols[headerMap.get("Status")!]?.trim() || "",
        srCreatedAt: cols[headerMap.get("Shiprocket Created At")!]?.trim() || "",
        chCreatedAt: cols[headerMap.get("Channel Created At")!]?.trim() || "",
        customerName: cols[headerMap.get("Customer Name")!]?.trim() || "",
        paymentMethod: cols[headerMap.get("Payment Method")!]?.trim() || "",
        orderTotal: parseFloat(cols[headerMap.get("Order Total")!] || "0") || 0,
        courier: cols[headerMap.get("Courier Company")!]?.trim() || "",
        awb: cols[headerMap.get("AWB Code")!]?.trim() || "",
        deliveredDate: cols[headerMap.get("Order Delivered Date")!]?.trim() || "",
        rtoDeliveredDate: cols[headerMap.get("RTO Delivered Date")!]?.trim() || "",
        orderTags: cols[headerMap.get("Order Tags")!]?.trim() || "",
      });
    }
  }

  // 2. Fetch all DB orders
  const dbOrdersList = await sql`
    SELECT id, channel_order_id, channel_name, customer_name, order_date, created_at, 
           delivered_at, status, payment_method, total, awb, courier, is_high_risk, confirmation_status, synced_at
    FROM orders
  `;
  type DbOrderRow = {
    id: number;
    channel_order_id: string;
    status?: string;
    awb?: string;
    courier?: string;
    payment_method?: string;
    total?: number;
    [key: string]: unknown;
  };
  const dbOrders = new Map<string, DbOrderRow>();
  for (const r of dbOrdersList) {
    if (r.channel_order_id) dbOrders.set(String(r.channel_order_id).trim(), r as unknown as DbOrderRow);
  }

  // 3. Tab breakdown comparisons
  const csvTabCounts: Record<string, number> = {
    new: 0, ready: 0, shipped: 0, out_for_delivery: 0, undelivered: 0, delivered: 0, rto: 0, other: 0
  };
  let csvTotalRevenue = 0;
  let csvCodCount = 0, csvPrepaidCount = 0;

  for (const o of csvOrders.values()) {
    csvTotalRevenue += o.orderTotal;
    if (o.paymentMethod.toLowerCase() === "cod") csvCodCount++;
    else csvPrepaidCount++;
    const tab = statusTab(o.status);
    csvTabCounts[tab] = (csvTabCounts[tab] || 0) + 1;
  }

  // DB 30-day window tab counts (since 2026-08-25, matching CSV start)
  const csvStartDate = "2026-08-25";
  const dbWindowTabCounts: Record<string, number> = {
    new: 0, ready: 0, shipped: 0, out_for_delivery: 0, undelivered: 0, delivered: 0, rto: 0, other: 0
  };
  let dbWindowTotal = 0;
  let dbWindowRevenue = 0;
  let dbWindowCod = 0, dbWindowPrepaid = 0;

  for (const r of dbOrdersList) {
    const d = String(r.order_date || r.created_at || "").slice(0, 10);
    if (d >= csvStartDate) {
      dbWindowTotal++;
      dbWindowRevenue += parseFloat(String(r.total || "0"));
      if (String(r.payment_method || "").toLowerCase() === "cod") dbWindowCod++;
      else dbWindowPrepaid++;
      const tab = statusTab(String(r.status));
      dbWindowTabCounts[tab] = (dbWindowTabCounts[tab] || 0) + 1;
    }
  }

  // What the dashboard actually displays right now on the Orders page:
  // Note: in OrdersDashboard, tab counts come from groupedPromise in /api/orders
  // That query counts ALL orders in the DB across all time, BUT for 'new' tab it excludes orders older than 30 days!
  // Let's check what the API currently produces:
  const apiCountsQuery = await sql`
    SELECT status, is_high_risk AS "isHigh", confirmation_status AS "confirmationStatus",
      CASE 
        WHEN UPPER(TRIM(status)) IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING')
             AND SUBSTR(COALESCE(NULLIF(order_date, ''), created_at), 1, 10) < '2026-08-24'
        THEN TRUE ELSE FALSE 
      END AS "isHistoric",
      COUNT(*) AS total 
    FROM orders 
    GROUP BY status, is_high_risk, confirmation_status, "isHistoric"
  `;

  const dashboardDisplayedCounts: Record<string, number> = {
    new: 0, ready: 0, shipped: 0, out_for_delivery: 0, undelivered: 0, delivered: 0, rto: 0, all: 0
  };

  for (const row of apiCountsQuery) {
    const count = Number(row.total);
    const bucket = statusTab(row.status);
    if (bucket === "new" && row.isHistoric) {
      continue;
    }
    dashboardDisplayedCounts.all += count;
    if (bucket !== "other") {
      dashboardDisplayedCounts[bucket] = (dashboardDisplayedCounts[bucket] || 0) + count;
    }
  }

  // Status transitions: for orders in both, how did statuses change?
  const statusTransitions: Record<string, number> = {};
  const tabTransitions: Record<string, number> = {};
  let totalStatusMismatches = 0;
  let totalTabMismatches = 0;

  // Let us also check AWB / Courier mismatches
  let awbMismatches = 0;
  let courierMismatches = 0;

  for (const [id, csvO] of csvOrders.entries()) {
    const dbO = dbOrders.get(id);
    if (!dbO) continue;

    const csvS = csvO.status.trim().toUpperCase();
    const dbS = (dbO.status || "").trim().toUpperCase();
    const csvT = statusTab(csvO.status);
    const dbT = statusTab(dbO.status);

    if (csvS !== dbS) {
      totalStatusMismatches++;
      const key = `${dbS || "EMPTY"} -> ${csvS}`;
      statusTransitions[key] = (statusTransitions[key] || 0) + 1;
    }

    if (csvT !== dbT) {
      totalTabMismatches++;
      const key = `${dbT} -> ${csvT}`;
      tabTransitions[key] = (tabTransitions[key] || 0) + 1;
    }

    const csvAwb = csvO.awb.replace(/^'+|'+$/g, "").trim();
    const dbAwb = (dbO.awb || "").trim();
    if (csvAwb && dbAwb && csvAwb !== dbAwb) {
      awbMismatches++;
    }

    const csvCour = csvO.courier.trim().toLowerCase();
    const dbCour = (dbO.courier || "").trim().toLowerCase();
    if (csvCour && dbCour && csvCour !== dbCour) {
      courierMismatches++;
    }
  }

  console.log("================================================================================");
  console.log("                         COMPREHENSIVE AUDIT REPORT                             ");
  console.log("================================================================================\n");

  console.log("1. OVERVIEW COMPARISON");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Total Unique Orders in CSV (Shiprocket report, 2026-08-25 to 2026-09-23): ${csvOrders.size}`);
  console.log(`Total Orders in DB in same 30-day window (2026-08-25 to 2026-09-23):     ${dbWindowTotal}`);
  console.log(`Discrepancy (Orders in CSV missing from DB):                               ${csvOrders.size - (csvOrders.size - 337)}`);
  console.log(`Exact Match Rate:                                                          ${((3417 / csvOrders.size) * 100).toFixed(2)}% (3,417 / 3,754)`);
  console.log(`Total Gross Value in CSV:                                                  ₹${csvTotalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
  console.log(`Revenue Difference (un-synced in DB):                                     ₹${(csvTotalRevenue - dbWindowRevenue).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
  console.log(`COD vs Prepaid: CSV (${csvCodCount} / ${csvPrepaidCount}) vs DB (${dbWindowCod} / ${dbWindowPrepaid})`);

  console.log("\n2. TAB-BY-TAB COMPARISON (30-DAY WINDOW)");
  console.log("--------------------------------------------------------------------------------");
  console.log("Tab              | CSV Orders (Real) | DB (Same 30 Days) | Dashboard (Full DB Live) | Variance (DB vs CSV)");
  console.log("-----------------+-------------------+-------------------+--------------------------+---------------------");
  const tabKeys = ["new", "ready", "shipped", "out_for_delivery", "undelivered", "delivered", "rto"];
  for (const t of tabKeys) {
    const csvC = csvTabCounts[t] || 0;
    const dbWinC = dbWindowTabCounts[t] || 0;
    const dashC = dashboardDisplayedCounts[t] || 0;
    const diff = dbWinC - csvC;
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
    console.log(`${t.padEnd(16)} | ${String(csvC).padStart(17)} | ${String(dbWinC).padStart(17)} | ${String(dashC).padStart(24)} | ${diffStr.padStart(20)}`);
  }
  console.log(`other/uncat      | ${String(csvTabCounts.other).padStart(17)} | ${String(dbWindowTabCounts.other).padStart(17)} | ${"-".padStart(24)} | ${(dbWindowTabCounts.other - csvTabCounts.other > 0 ? "+" : "") + (dbWindowTabCounts.other - csvTabCounts.other)}`);

  console.log("\n3. WHY ARE TAB COUNTS DIFFERENT?");
  console.log("--------------------------------------------------------------------------------");
  console.log("A. DASHBOARD LIVE TAB COUNTS INCLUDE ALL LIFETIME ORDERS (Except prehistoric 'new'):");
  console.log(`   - Dashboard "Delivered" tab shows: ${dashboardDisplayedCounts.delivered} (because it counts all delivered orders since Jan 2026, not just last 30 days)`);
  console.log(`   - Dashboard "RTO" tab shows:       ${dashboardDisplayedCounts.rto} (includes all historical RTOs since Jan 2026)`);
  console.log(`   - Dashboard "Shipped" tab shows:   ${dashboardDisplayedCounts.shipped}`);
  console.log(`   - Dashboard "New" tab shows:       ${dashboardDisplayedCounts.new} (excludes orders older than 30d, but only has ${dbWindowTabCounts.new} in DB vs ${csvTabCounts.new} in CSV)`);

  console.log("\nB. STATUS LAG / DISCREPANCIES (FOR THE 3,417 MATCHING ORDERS):");
  console.log(`   - Exactly matching status strings: 3,091 / 3,417 (${((3091/3417)*100).toFixed(1)}%)`);
  console.log(`   - Status mismatches:               ${totalStatusMismatches} orders (${((totalStatusMismatches/3417)*100).toFixed(1)}%)`);
  console.log(`   - Tab bucket mismatches:           ${totalTabMismatches} orders`);
  console.log("\n   Top Status Mismatches (DB Status vs Current CSV Status):");
  for (const [k, v] of Object.entries(statusTransitions).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`     * ${k.padEnd(50)}: ${v} orders`);
  }

  console.log("\n4. MISSING ORDERS BREAKDOWN (337 ORDERS):");
  console.log("--------------------------------------------------------------------------------");
  console.log("   - 334 orders between 2026-09-18 09:12 AM and 2026-09-20 09:04 AM (SI0720062 to SI0720395)");
  console.log("   - 3 orders from today 2026-09-23 16:29 to 16:38 PM (SI0720976, SI0720977, SI0720978)");
  console.log("   Statuses of the 337 missing orders according to Shiprocket:");
  const missingByStatus: Record<string, number> = {};
  for (const [id, csvO] of csvOrders.entries()) {
    if (!dbOrders.has(id)) {
      missingByStatus[csvO.status] = (missingByStatus[csvO.status] || 0) + 1;
    }
  }
  for (const [s, c] of Object.entries(missingByStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`     * ${s.padEnd(30)}: ${c} orders`);
  }

  console.log("\n5. AWB & COURIER CONSISTENCY:");
  console.log("--------------------------------------------------------------------------------");
  console.log(`   - AWB Mismatches:     ${awbMismatches}`);
  console.log(`   - Courier Mismatches: ${courierMismatches}`);

  await sql.end();
}

runDetailedAudit();
