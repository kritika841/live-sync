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

async function bulkReconcile() {
  console.log("=== EXECUTING FAST BULK STATUS RECONCILIATION ===");
  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 2, connect_timeout: 15 });

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

  const items = Array.from(orderUpdates.values());
  console.log(`Loaded ${items.length} records. Updating database in batches of 400...`);

  const batchSize = 400;
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const orderIds = chunk.map(c => c.orderId);
    const statuses = chunk.map(c => c.status);
    const deliveredAts = chunk.map(c => normalizeDate(c.deliveredDate));
    const awbs = chunk.map(c => c.awb);
    const couriers = chunk.map(c => c.courier);

    await sql`
      UPDATE orders AS o
      SET
        status = v.status,
        delivered_at = CASE WHEN v.delivered_at <> '' THEN v.delivered_at ELSE o.delivered_at END,
        awb = CASE WHEN v.awb <> '' THEN v.awb ELSE o.awb END,
        courier = CASE WHEN v.courier <> '' THEN v.courier ELSE o.courier END,
        synced_at = NOW()::text
      FROM (
        SELECT 
          UNNEST(${orderIds}::text[]) as channel_order_id,
          UNNEST(${statuses}::text[]) as status,
          UNNEST(${deliveredAts}::text[]) as delivered_at,
          UNNEST(${awbs}::text[]) as awb,
          UNNEST(${couriers}::text[]) as courier
      ) AS v
      WHERE o.channel_order_id = v.channel_order_id
    `;
    console.log(`Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)} applied (${Math.min(i + batchSize, items.length)} orders)`);
  }

  // Update sync_state
  const now = new Date().toISOString();
  await sql`
    INSERT INTO sync_state (key, value, updated_at) VALUES ('last_sync_at', ${now}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `;
  await sql`
    INSERT INTO sync_state (key, value, updated_at) VALUES ('sync_status', 'healthy', ${now})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `;

  console.log("=== BULK STATUS RECONCILIATION COMPLETED SUCCESSFULLY ===");
  await sql.end();
}

bulkReconcile().catch(err => {
  console.error("Bulk reconcile failed:", err);
  process.exit(1);
});
