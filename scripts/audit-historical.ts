import fs from "fs";
import readline from "readline";
import { getRuntimeEnv } from "../lib/database";
import { loadOfdRecords } from "../lib/ofd";

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
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

async function run() {
  const rt = getRuntimeEnv();
  const file = "report/secure_9341191_reports_1791955841967840980-dbae6724bd3c227d6e09fdb686e18660- (1).csv";
  
  const fileStream = fs.createReadStream(file, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] = [];
  const headerMap = new Map<string, number>();
  let rowIdx = 0;

  const csvOrders = new Map<string, {
    orderId: string;
    awb: string;
    status: string;
    latestOfd: string;
    firstOfd: string;
    deliveredDate: string;
  }>();

  for await (const line of rl) {
    if (rowIdx++ === 0) {
      headers = parseCsvLine(line);
      headers.forEach((h, i) => headerMap.set(h, i));
      continue;
    }
    const cols = parseCsvLine(line);
    const orderId = cols[headerMap.get("Order ID")!] || "";
    if (!orderId) continue;
    if (!csvOrders.has(orderId)) {
      csvOrders.set(orderId, {
        orderId,
        awb: cols[headerMap.get("AWB Code")!] || "",
        status: (cols[headerMap.get("Status")!] || "").trim(),
        latestOfd: (cols[headerMap.get("Latest OFD Date")!] || "").trim(),
        firstOfd: (cols[headerMap.get("First Out For Delivery Date")!] || "").trim(),
        deliveredDate: (cols[headerMap.get("Order Delivered Date")!] || "").trim(),
      });
    }
  }

  console.log("=========================================================================================");
  console.log("            HISTORICAL AUDIT: CSV REPORT vs SYSTEM (CLOSED DATES)                       ");
  console.log("=========================================================================================\n");

  const dates = ["2026-10-13", "2026-10-12", "2026-10-11", "2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07"];

  for (const date of dates) {
    const csvForDate = Array.from(csvOrders.values()).filter(o => 
      o.latestOfd.startsWith(date) || (o.firstOfd.startsWith(date) && !o.latestOfd.startsWith(date))
    );

    const dbRes = await loadOfdRecords(rt.DB, date);

    // CSV counts by normalized status
    let csvDelivered = 0;
    let csvUndelivered = 0;
    let csvStillOut = 0;
    let csvRto = 0;

    for (const o of csvForDate) {
      const s = o.status.toUpperCase();
      if (s === "DELIVERED") csvDelivered++;
      else if (s === "OUT FOR DELIVERY") csvStillOut++;
      else if (s.includes("RTO")) csvRto++;
      else csvUndelivered++;
    }

    // DB counts by status
    let dbDelivered = 0;
    let dbUndelivered = 0;
    let dbStillOut = 0;
    let dbRto = 0;

    for (const r of dbRes.results) {
      const s = (r.status || "").toUpperCase();
      if (s === "DELIVERED") dbDelivered++;
      else if (s === "OUT FOR DELIVERY") dbStillOut++;
      else if (s.includes("RTO")) dbRto++;
      else dbUndelivered++;
    }

    console.log(`DATE: ${date}`);
    console.log(`  • CSV Unique Orders: ${csvForDate.length}  (Delivered: ${csvDelivered}, Undelivered/NDR: ${csvUndelivered}, RTO: ${csvRto}, StillOut: ${csvStillOut})`);
    console.log(`  • DB Unique Orders:  ${dbRes.results.length}  (Delivered: ${dbDelivered}, Undelivered/NDR: ${dbUndelivered}, RTO: ${dbRto}, StillOut: ${dbStillOut})`);
    console.log("-----------------------------------------------------------------------------------------");
  }
}

run().then(() => process.exit(0)).catch(console.error);
