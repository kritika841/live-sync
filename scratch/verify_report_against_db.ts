import fs from "fs";
import { getRuntimeEnv } from "../lib/database";
import { loadOfdRecords } from "../lib/ofd";

// Helper to parse CSV properly taking into account quoted strings
function parseCSV(text: string) {
  const lines: string[] = [];
  let current = "";
  let insideQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      insideQuotes = !insideQuotes;
      current += char;
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (current.trim().length > 0) lines.push(current);
      current = "";
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) lines.push(current);

  const headerLine = lines[0];
  const headers = splitRow(headerLine);
  
  const records: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitRow(lines[i]);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = vals[j] || "";
    }
    records.push(obj);
  }
  return records;
}

function splitRow(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim().replace(/^"|"$/g, ''));
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim().replace(/^"|"$/g, ''));
  return result;
}

async function main() {
  const rt = getRuntimeEnv();
  const reportPath = "/Users/kritikasingh/Downloads/shiprocket live sync/report/secure_9341191_reports_1791876747597210549-c349db9dbc65ba4f935eb4d0bd1dfa12-.csv";
  const content = fs.readFileSync(reportPath, "utf-8");
  const reportRows = parseCSV(content);
  console.log(`Parsed ${reportRows.length} item rows from report.`);

  // Group by Order ID / AWB Code
  const reportOrders = new Map<string, any>();
  for (const row of reportRows) {
    const channelOrderId = row["Order ID"];
    const awb = row["AWB Code"];
    const key = awb || channelOrderId;
    if (key && !reportOrders.has(key)) {
      reportOrders.set(key, {
        channelOrderId,
        awb,
        status: row["Status"]?.trim(),
        latestOfd: row["Latest OFD Date"]?.trim(),
        firstOfd: row["First Out For Delivery Date"]?.trim(),
        deliveredDate: row["Order Delivered Date"]?.trim(),
        attemptCount: row["Attempt Count"]?.trim(),
        ndrDate: row["Latest NDR Date"]?.trim(),
        ndrReason: row["Latest NDR Reason"]?.trim(),
      });
    }
  }
  console.log(`Unique shipments in report: ${reportOrders.size}`);

  // Filter those that have Latest OFD on 2026-10-13 or Status = OUT FOR DELIVERY
  const reportOfdToday = Array.from(reportOrders.values()).filter(
    (o) => o.latestOfd?.startsWith("2026-10-13") || o.firstOfd?.startsWith("2026-10-13") || o.status?.toUpperCase() === "OUT FOR DELIVERY"
  );
  console.log(`\n=== Shiprocket Report Today OFD Shipments: ${reportOfdToday.length} ===`);

  // Status breakdown in report
  const repStatusCounts: Record<string, number> = {};
  for (const o of reportOfdToday) {
    const s = o.status.toUpperCase();
    repStatusCounts[s] = (repStatusCounts[s] || 0) + 1;
  }
  console.log("Report Status Breakdown:", repStatusCounts);

  // Load from DB
  const ofdDb = await loadOfdRecords(rt.DB, "2026-10-13");
  console.log(`\n=== Database loadOfdRecords Today (2026-10-13): ${ofdDb.results.length} ===`);

  // Compare every report OFD shipment against DB
  const dbByAwb = new Map(ofdDb.results.map((r) => [r.awb, r]));
  const dbByChannelId = new Map(ofdDb.results.map((r) => [r.channelOrderId, r]));

  let matchedInDb = 0;
  let statusMatches = 0;
  let statusUpdatesNeeded = 0;
  const updates: any[] = [];

  for (const rep of reportOfdToday) {
    const dbOrder = dbByAwb.get(rep.awb) || dbByChannelId.get(rep.channelOrderId);
    if (dbOrder) {
      matchedInDb++;
      const dbStatus = String(dbOrder.status).toUpperCase();
      const repStatus = rep.status.toUpperCase();
      if (dbStatus === repStatus) {
        statusMatches++;
      } else {
        statusUpdatesNeeded++;
        updates.push({
          order: rep.channelOrderId,
          awb: rep.awb,
          dbStatus,
          reportStatus: repStatus,
          reportDeliveredAt: rep.deliveredDate,
          dbDeliveredAt: dbOrder.deliveredAt,
        });
      }
    } else {
      console.log(`Report OFD order NOT in DB Today's OFD: Order ${rep.channelOrderId}, AWB ${rep.awb}, Status ${rep.status}`);
    }
  }

  console.log(`\nReport OFD Orders Matched in DB OFD: ${matchedInDb} / ${reportOfdToday.length}`);
  console.log(`Exact status matches: ${statusMatches}`);
  console.log(`Status changes (e.g. freshly delivered in newer report): ${statusUpdatesNeeded}`);
  if (updates.length > 0) {
    console.log("Sample status differences between DB and newest report:");
    console.table(updates.slice(0, 15));
  }

  // Also check how many DB OFD orders are from dates earlier than the report window (before Oct 7)
  const reportChannelIds = new Set(Array.from(reportOrders.values()).map(o => o.channelOrderId));
  const reportAwbs = new Set(Array.from(reportOrders.values()).map(o => o.awb).filter(Boolean));
  
  const dbOrdersNotInReport = ofdDb.results.filter(
    (r) => !reportChannelIds.has(r.channelOrderId) && !reportAwbs.has(r.awb)
  );
  console.log(`\nDB OFD orders not in report: ${dbOrdersNotInReport.length}`);
  console.log(`(These are orders placed before Oct 07 that went out for delivery today, e.g. Oct 01–Oct 06 orders)`);
  if (dbOrdersNotInReport.length > 0) {
    console.table(
      dbOrdersNotInReport.slice(0, 10).map((r) => ({
        id: r.id,
        channelOrder: r.channelOrderId,
        awb: r.awb,
        status: r.status,
        shippedAt: r.shippedAt?.slice(0, 10),
      }))
    );
  }
}

main().then(() => process.exit(0)).catch(console.error);
