/**
 * Order-by-order reconciliation of the dashboard's OFD data against a Shiprocket CSV export.
 *
 * Usage:
 *   npm run reconcile:ofd -- <YYYY-MM-DD> [path/to/export.csv]
 *
 * The CSV is the ground truth. For the given IST date this prints every order where the
 * database and the CSV disagree:
 *   - MISSING IN DB      : CSV says OFD on that date, dashboard doesn't list it   (real bug)
 *   - STATUS MISMATCH    : current status differs                                  (real bug / stale sync)
 *   - DELIVERED MISMATCH : delivered date differs
 *   - ATTEMPT MISMATCH   : attempt count differs from CSV "Attempt Count"
 *   - NOT IN CSV (info)  : dashboard lists it, CSV's *latest* OFD date is another day
 *                          (expected for re-attempts; CSV only keeps the latest OFD date)
 * Exit code is 1 if any hard mismatch is found.
 */
import fs from "fs";
import path from "path";
import readline from "readline";
import { getRuntimeEnv } from "../lib/database";
import { loadOfdRecords } from "../lib/ofd";
import { toIndiaDate } from "../lib/ofd-attempt";

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
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

interface CsvOrder {
  orderId: string;
  awb: string;
  status: string;
  latestOfd: string;
  firstOfd: string;
  deliveredDate: string;
  attemptCount: number;
}

const clean = (v: string | undefined) => {
  const s = (v || "").trim();
  return s === "N/A" || s === "-" ? "" : s;
};

async function readCsv(file: string): Promise<Map<string, CsvOrder>> {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  const orders = new Map<string, CsvOrder>();
  const col = new Map<string, number>();
  let first = true;
  for await (const line of rl) {
    if (first) {
      parseCsvLine(line).forEach((h, i) => col.set(h, i));
      for (const required of ["Order ID", "Status", "Latest OFD Date"]) {
        if (!col.has(required)) throw new Error(`CSV is missing required column "${required}"`);
      }
      first = false;
      continue;
    }
    if (!line.trim()) continue;
    const c = parseCsvLine(line);
    const get = (name: string) => clean(c[col.get(name) ?? -1]);
    const orderId = get("Order ID");
    if (!orderId || orders.has(orderId)) continue; // one row per SKU: keep the first per order
    orders.set(orderId, {
      orderId,
      awb: get("AWB Code"),
      status: get("Status").toUpperCase(),
      latestOfd: toIndiaDate(get("Latest OFD Date")),
      firstOfd: toIndiaDate(get("First Out For Delivery Date")),
      deliveredDate: toIndiaDate(get("Order Delivered Date")),
      attemptCount: Number(get("Attempt Count") || 0),
    });
  }
  return orders;
}

async function main() {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Usage: npm run reconcile:ofd -- <YYYY-MM-DD> [csv path]");
    process.exit(2);
  }
  const reportDir = path.resolve(process.cwd(), "report");
  const csvPath =
    process.argv[3] ||
    fs
      .readdirSync(reportDir)
      .filter((f) => f.endsWith(".csv"))
      .map((f) => path.join(reportDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error("No CSV found. Pass a path as the second argument.");
    process.exit(2);
  }

  const ageMin = Math.round((Date.now() - fs.statSync(csvPath).mtimeMs) / 60000);
  console.log(`Date: ${date}\nCSV : ${path.basename(csvPath)} (file is ${ageMin} min old)`);
  console.log("Note: for today's date, export a FRESH CSV first; anything newer than the export shows up as differences.\n");
  const csv = await readCsv(csvPath);
  const csvForDate = new Map(
    [...csv].filter(([, o]) => o.latestOfd === date || (!o.latestOfd && o.firstOfd === date))
  );
  if (csvForDate.size === 0) {
    console.error(
      `CSV has 0 orders with a Latest OFD Date of ${date} (of ${csv.size} orders). ` +
        "Wrong file or date? Cannot verify anything, so NOT reporting a match."
    );
    process.exit(2);
  }

  const db = getRuntimeEnv().DB;
  const dbRows = (await loadOfdRecords(db, date)).results;
  // CSV "Order ID" is the channel order number (e.g. SI0723727), so match on that, then AWB.
  const dbByChannel = new Map(dbRows.filter((r) => r.channelOrderId).map((r) => [r.channelOrderId.trim(), r]));
  const dbByAwb = new Map(dbRows.filter((r) => r.awb).map((r) => [r.awb.trim(), r]));
  const findDb = (o: CsvOrder) => dbByChannel.get(o.orderId) || (o.awb ? dbByAwb.get(o.awb) : undefined);

  const hard: string[] = [];
  const info: string[] = [];
  const matchedDb = new Set<unknown>();

  for (const [id, o] of csvForDate) {
    const r = findDb(o);
    if (!r) {
      hard.push(`MISSING IN DB      order ${id} awb ${o.awb} (CSV status ${o.status})`);
      continue;
    }
    matchedDb.add(r.id);
    const dbStatus = String(r.status || "").trim().toUpperCase();
    const dbIsAhead =
      o.status === "OUT FOR DELIVERY" && dbStatus !== "OUT FOR DELIVERY" && dbStatus !== "";
    if (dbIsAhead) {
      info.push(`DB AHEAD OF CSV    order ${id}: csv="${o.status}" db="${dbStatus}" (newer webhook than export)`);
      continue;
    }
    if (o.status && dbStatus !== o.status) {
      hard.push(`STATUS MISMATCH    order ${id}: db="${dbStatus}" csv="${o.status}"`);
    }
    const dbDelivered = toIndiaDate(r.deliveredAt);
    if (o.deliveredDate !== dbDelivered) {
      hard.push(`DELIVERED MISMATCH order ${id}: db="${dbDelivered}" csv="${o.deliveredDate}"`);
    }
    if (o.attemptCount > 0 && Number(r.attemptNumber) !== Math.min(4, o.attemptCount)) {
      hard.push(`ATTEMPT MISMATCH   order ${id}: db=${r.attemptNumber} csv=${o.attemptCount}`);
    }
  }
  for (const r of dbRows) {
    if (matchedDb.has(r.id)) continue;
    const o = csv.get(r.channelOrderId?.trim());
    info.push(
      `NOT IN CSV (info)  order ${r.channelOrderId || r.id}: ${o ? `CSV latest OFD = ${o.latestOfd || "none"}` : "order absent from CSV"}`
    );
  }

  console.log(`CSV orders with OFD on ${date}: ${csvForDate.size}`);
  console.log(`Dashboard orders for ${date}:  ${dbRows.length}`);
  console.log(`Hard mismatches: ${hard.length}   Informational: ${info.length}\n`);
  hard.forEach((l) => console.log(l));
  if (info.length) {
    console.log("");
    const byType = new Map<string, string[]>();
    for (const l of info) {
      const k = l.slice(0, 18).trim();
      byType.set(k, [...(byType.get(k) || []), l]);
    }
    for (const [k, lines] of byType) {
      console.log(`${k}: ${lines.length}`);
      lines.slice(0, 10).forEach((l) => console.log("  " + l));
      if (lines.length > 10) console.log(`  ... and ${lines.length - 10} more`);
    }
  }
  console.log(hard.length === 0 ? "\nRESULT: dashboard matches the CSV for this date." : "\nRESULT: MISMATCHES FOUND.");
  process.exit(hard.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
