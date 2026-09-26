import fs from "fs";
import readline from "readline";
import postgres from "postgres";

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

function normalizeDate(str: string): string {
  const s = str.replace(/['"]+/g, "").trim();
  if (!s || s === "N/A") return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.replace(" ", "T") + (s.includes("+") || s.includes("Z") ? "" : "+05:30");
  }
  return s;
}

async function reconcileFromCsv() {
  console.log("=== RECONCILING ALL 30-DAY ORDERS DIRECTLY WITH CSV REPORT ===");
  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 4, connect_timeout: 15 });

  const csvPath = "report/secure_9341191_reports_1790161896103398733-df45f5137bd92a5208a1582184cca89a-.csv";
  const fileStream = fs.createReadStream(csvPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] = [];
  const headerMap = new Map<string, number>();
  let rowIdx = 0;

  const orderUpdates = new Map<string, {
    orderId: string;
    status: string;
    deliveredDate: string;
    awb: string;
    courier: string;
  }>();

  for await (const line of rl) {
    if (rowIdx++ === 0) {
      headers = parseCsvLine(line).map(h => h.trim());
      headers.forEach((h, i) => headerMap.set(h, i));
      continue;
    }
    const cols = parseCsvLine(line);
    const orderId = (cols[headerMap.get("Order ID")!] || "").trim();
    if (!orderId) continue;

    const status = (cols[headerMap.get("Status")!] || "").trim();
    const rawDelivered = (cols[headerMap.get("Order Delivered Date")!] || "").trim();
    const rawAwb = (cols[headerMap.get("AWB Code")!] || "").replace(/^'+|'+$/g, "").trim();
    const courier = (cols[headerMap.get("Courier Company")!] || "").trim();

    if (!orderUpdates.has(orderId)) {
      orderUpdates.set(orderId, {
        orderId,
        status,
        deliveredDate: rawDelivered,
        awb: rawAwb === "N/A" ? "" : rawAwb,
        courier: courier === "N/A" ? "" : courier,
      });
    } else {
      const existing = orderUpdates.get(orderId)!;
      if (status && !existing.status) existing.status = status;
      if (rawDelivered && !existing.deliveredDate) existing.deliveredDate = rawDelivered;
      if (rawAwb && rawAwb !== "N/A" && !existing.awb) existing.awb = rawAwb;
      if (courier && courier !== "N/A" && !existing.courier) existing.courier = courier;
    }
  }

  console.log(`Parsed ${orderUpdates.size} orders from CSV. Performing database updates...`);

  let updatedCount = 0;
  const updatesList = Array.from(orderUpdates.values());
  const batchSize = 100;

  for (let i = 0; i < updatesList.length; i += batchSize) {
    const chunk = updatesList.slice(i, i + batchSize);
    await Promise.all(chunk.map(async (item) => {
      const deliveredAt = normalizeDate(item.deliveredDate);
      await sql`
        UPDATE orders SET
          status = ${item.status},
          delivered_at = CASE 
            WHEN ${deliveredAt} <> '' THEN ${deliveredAt}
            ELSE delivered_at
          END,
          awb = CASE 
            WHEN ${item.awb} <> '' THEN ${item.awb}
            ELSE awb
          END,
          courier = CASE 
            WHEN ${item.courier} <> '' THEN ${item.courier}
            ELSE courier
          END,
          synced_at = NOW()
        WHERE channel_order_id = ${item.orderId}
      `;
    }));
    updatedCount += chunk.length;
    if (updatedCount % 500 === 0 || updatedCount === updatesList.length) {
      console.log(`Updated ${updatedCount}/${updatesList.length} orders...`);
    }
  }

  console.log("=== RECONCILIATION COMPLETE! ===");
  await sql.end();
}

reconcileFromCsv().catch(err => {
  console.error("Reconciliation failed:", err);
  process.exit(1);
});
