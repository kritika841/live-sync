/**
 * Ingests a fresh Shiprocket CSV export as ground truth:
 *   1. repairs stale OFD / attempt / delivery fields on `orders` (with a JSON backup of old values)
 *   2. rebuilds the permanent per-day OFD ledger (`ofd_ledger`) for every PASSED day (closed, final)
 *   3. prints a reconciliation of before vs after against the CSV
 *
 * Usage:
 *   npm run ingest:ofd                 # dry run on newest CSV in /report (no writes)
 *   npm run ingest:ofd -- --apply      # write repairs + ledger
 *   npm run ingest:ofd -- --apply --force   # also overwrite days already sealed from an earlier CSV
 *   npm run ingest:ofd -- path/to.csv --apply
 */
import fs from "fs";
import path from "path";
import { getRuntimeEnv } from "../lib/database";
import { loadOfdRecords } from "../lib/ofd";
import { toIndiaDate } from "../lib/ofd-attempt";
import { getIndiaDate } from "../lib/ofd-audit";
import { attemptNumberForDay, ofdDaysOf, readOfdCsv, statusForDay, type CsvOfdOrder } from "../lib/ofd-csv";
import { ensureOfdLedgerSchema, writeLedgerRows, type LedgerOrder, type LedgerWrite } from "../lib/ofd-ledger";

type DbOrder = {
  id: string | number;
  channel_order_id: string;
  awb: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  customer_state: string;
  courier: string;
  payment_method: string;
  total: number;
  shipped_at: string;
  shipping_cost: number;
  ndr_reason: string;
  ndr_raised_at: string;
  first_out_for_delivery_at: string;
  out_for_delivery_at: string;
  delivered_at: string;
  ndr_attempts: number;
  attempt_count: number;
  status: string;
  updated_at: string;
};

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const csvArg = args.find((a) => !a.startsWith("--"));

function newestCsv(): string {
  const dir = path.resolve(process.cwd(), "report");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files[0]) throw new Error("No CSV in /report");
  return files[0];
}

async function liveCounts(db: ReturnType<typeof getRuntimeEnv>["DB"], dates: string[]) {
  const out = new Map<string, number>();
  for (const d of dates) out.set(d, (await loadOfdRecords(db, d)).results.length);
  return out;
}

async function main() {
  const file = csvArg || newestCsv();
  const exportedAt = fs.statSync(file).mtimeMs;
  const today = getIndiaDate();
  console.log(`CSV      : ${path.basename(file)} (exported ${new Date(exportedAt).toISOString()})`);
  console.log(`Mode     : ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes) — add --apply to write"}${FORCE ? " + force" : ""}`);
  console.log(`Today    : ${today}\n`);

  const csv = readOfdCsv(fs.readFileSync(file, "utf-8"));
  console.log(`CSV orders: ${csv.size.toLocaleString()}`);

  const db = getRuntimeEnv().DB;
  await ensureOfdLedgerSchema(db);

  const dbRows = (
    await db
      .prepare(
        `SELECT id, channel_order_id, awb, customer_name, customer_phone, customer_city, customer_state, courier,
                payment_method, total, shipped_at, shipping_cost, ndr_reason, ndr_raised_at,
                first_out_for_delivery_at, out_for_delivery_at, delivered_at, ndr_attempts, attempt_count, status, updated_at
         FROM orders`
      )
      .all<DbOrder>()
  ).results;
  const byChannel = new Map<string, DbOrder>();
  const byAwb = new Map<string, DbOrder>();
  for (const r of dbRows) {
    if (r.channel_order_id) byChannel.set(String(r.channel_order_id).trim(), r);
    if (r.awb) byAwb.set(String(r.awb).trim(), r);
  }
  const match = (o: CsvOfdOrder) => byChannel.get(o.channelOrderId) || (o.awb ? byAwb.get(o.awb) : undefined);

  // ---- before snapshot ---------------------------------------------------------------------
  const recentDays = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(`${today}T12:00:00+05:30`);
    d.setDate(d.getDate() - i);
    return getIndiaDate(d);
  }).reverse();
  const before = await liveCounts(db, recentDays);

  // ---- 1. repairs on orders ----------------------------------------------------------------
  const repairs: { id: string | number; channel: string; set: Record<string, string | number>; old: Record<string, unknown> }[] = [];
  let unmatched = 0;
  for (const o of csv.values()) {
    const r = match(o);
    if (!r) {
      if (o.latestOfdDate) unmatched++;
      continue;
    }
    const set: Record<string, string | number> = {};
    const old: Record<string, unknown> = {};
    const change = (col: keyof DbOrder, value: string | number) => {
      set[col] = value;
      old[col] = r[col];
    };

    if (o.latestOfdDate && toIndiaDate(r.out_for_delivery_at) !== o.latestOfdDate) {
      const sameAsFirst = o.firstOfdAt && toIndiaDate(o.firstOfdAt) === o.latestOfdDate;
      change("out_for_delivery_at", sameAsFirst ? o.firstOfdAt : `${o.latestOfdDate}T10:00:00+05:30`);
    }
    if (o.firstOfdAt && toIndiaDate(r.first_out_for_delivery_at) !== toIndiaDate(o.firstOfdAt)) {
      change("first_out_for_delivery_at", o.firstOfdAt);
    }
    if (o.attemptCount > Number(r.attempt_count || 0)) change("attempt_count", o.attemptCount);
    if (o.ndrDates.length > Number(r.ndr_attempts || 0)) change("ndr_attempts", o.ndrDates.length);
    if (o.deliveredAt && !r.delivered_at) change("delivered_at", o.deliveredAt);
    // CSV wins on status only if our row was last written before the export was taken.
    const dbUpdated = Date.parse(String(r.updated_at || ""));
    if (o.status && String(r.status || "").trim().toUpperCase() !== o.status && !(dbUpdated >= exportedAt)) {
      change("status", o.status);
    }
    if (Object.keys(set).length) repairs.push({ id: r.id, channel: o.channelOrderId, set, old });
  }
  const fieldCounts = new Map<string, number>();
  repairs.forEach((x) => Object.keys(x.set).forEach((k) => fieldCounts.set(k, (fieldCounts.get(k) || 0) + 1)));
  console.log(`\nOrders needing repair: ${repairs.length.toLocaleString()} (CSV orders not in DB with an OFD date: ${unmatched})`);
  fieldCounts.forEach((n, k) => console.log(`  ${k.padEnd(28)} ${n}`));

  if (APPLY && repairs.length) {
    const outDir = path.resolve(process.cwd(), "outputs");
    fs.mkdirSync(outDir, { recursive: true });
    const backup = path.join(outDir, `ofd-repair-backup-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(repairs, null, 1));
    console.log(`  backup of previous values: ${backup}`);
    const now = new Date().toISOString();
    for (let i = 0; i < repairs.length; i += 25) {
      await Promise.all(
        repairs.slice(i, i + 25).map((x) => {
          const cols = Object.keys(x.set);
          return db
            .prepare(`UPDATE orders SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
            .bind(...cols.map((c) => x.set[c]), now, x.id)
            .run();
        })
      );
    }
    console.log("  repairs applied");
  }

  // ---- 2. ledger for every passed day -------------------------------------------------------
  const ledger: LedgerWrite[] = [];
  const perDay = new Map<string, number>();
  for (const o of csv.values()) {
    const r = match(o);
    if (!r) continue;
    const days = ofdDaysOf(o);
    // Membership is exactly the sheet's rule: an order belongs to the day of its Latest OFD Date
    // (falling back to its first OFD date when the sheet has no latest date).
    const memberDay = o.latestOfdDate || toIndiaDate(o.firstOfdAt);
    if (!memberDay) continue;
    for (const day of [memberDay]) {
      if (day >= today) continue; // today stays live
      const attempt = attemptNumberForDay(o, days, day);
      const status = statusForDay(o, day, today);
      const idx = o.ndrDates.indexOf(day);
      const firstDay = toIndiaDate(o.firstOfdAt);
      const ofdAt =
        day === firstDay
          ? o.firstOfdAt
          : toIndiaDate(r.out_for_delivery_at) === day
            ? String(r.out_for_delivery_at)
            : `${day}T10:00:00+05:30`;
      const order: LedgerOrder = {
        id: r.id,
        channelOrderId: String(r.channel_order_id || o.channelOrderId),
        customerName: String(r.customer_name || ""),
        customerPhone: String(r.customer_phone || ""),
        customerCity: String(r.customer_city || ""),
        customerState: String(r.customer_state || ""),
        status,
        paymentMethod: String(r.payment_method || ""),
        total: Number(r.total || 0),
        awb: String(r.awb || o.awb),
        courier: String(r.courier || ""),
        shippedAt: String(r.shipped_at || ""),
        firstOutForDeliveryAt: o.firstOfdAt || String(r.first_out_for_delivery_at || ""),
        outForDeliveryAt: ofdAt,
        deliveredAt: o.deliveredAt,
        ndrReason: idx >= 0 ? o.ndrRemarks[idx] || "" : "",
        ndrAttempts: o.ndrDates.length,
        ndrRaisedAt: idx >= 0 ? `${day}T00:00:00+05:30` : "",
        shippingCost: Number(r.shipping_cost || 0),
        recordedOfdDays: attempt,
        attemptNumber: attempt,
        attemptCount: attempt,
        previousUndelivered: attempt > 1,
        webhookCount: 0,
        eventsLog: [],
        verifiedStatus: "pending",
        notes: "",
        closedFromCsv: true,
      };
      ledger.push({ date: day, order });
      perDay.set(day, (perDay.get(day) || 0) + 1);
    }
  }
  console.log(`\nLedger rows for closed days: ${ledger.length.toLocaleString()} across ${perDay.size} days`);
  if (APPLY) {
    await writeLedgerRows(db, ledger, { mode: "csv", closed: true, force: FORCE });
    // CSV is ground truth: drop csv/live rows on these days that the sheet does not contain.
    const keep = new Set(ledger.map((l) => `${l.date}|${l.order.id}`));
    const stale = (
      await db.prepare("SELECT id, ofd_date, order_id FROM ofd_ledger WHERE source IN ('live', 'csv', 'webhook')").all<{ id: number | string; ofd_date: string; order_id: number | string }>()
    ).results.filter((r) => perDay.has(r.ofd_date) && !keep.has(`${r.ofd_date}|${r.order_id}`));
    for (let i = 0; i < stale.length; i += 500) {
      const ids = stale.slice(i, i + 500).map((r) => Number(r.id));
      await db.prepare(`DELETE FROM ofd_ledger WHERE id IN (${ids.join(",")})`).run();
    }
    if (stale.length) console.log(`  pruned ${stale.length} ledger row(s) not present in the sheet`);
    // Drop stale cached payloads so the UI rebuilds from the ledger.
    await db.prepare("DELETE FROM analytics_cache WHERE cache_key LIKE 'today_ofd_%'").run().catch(() => null);
    console.log("  ledger written (stale Today's OFD caches cleared)");
  }

  // ---- 3. reconciliation -------------------------------------------------------------------
  const csvToday = [...csv.values()].filter((o) => (o.latestOfdDate || toIndiaDate(o.firstOfdAt)) === today).length;
  const after = APPLY ? await liveCounts(db, [today]) : new Map<string, number>();
  console.log("\nRECONCILIATION (orders that went out for delivery)");
  console.log("Date       | CSV truth | Dashboard before | Dashboard after");
  for (const d of recentDays) {
    const truth = d === today ? csvToday : perDay.get(d) || 0;
    const b = before.get(d) ?? 0;
    const a = d === today ? (APPLY ? after.get(d) : "n/a (dry run)") : APPLY ? `${truth} (ledger)` : "n/a (dry run)";
    const flag = b === truth ? "" : "  <-- differed";
    console.log(`${d} | ${String(truth).padStart(9)} | ${String(b).padStart(16)} | ${String(a).padStart(15)}${flag}`);
  }
  if (APPLY) {
    const stored = (await db.prepare("SELECT ofd_date, COUNT(*) AS c FROM ofd_ledger GROUP BY ofd_date").all<{ ofd_date: string; c: string | number }>()).results;
    const storedMap = new Map(stored.map((r) => [r.ofd_date, Number(r.c)]));
    const bad: string[] = [];
    for (const d of new Set([...perDay.keys(), ...storedMap.keys()])) {
      if ((perDay.get(d) || 0) !== (storedMap.get(d) || 0)) bad.push(`${d}: sheet=${perDay.get(d) || 0} stored=${storedMap.get(d) || 0}`);
    }
    console.log(`\nFULL-HISTORY AUDIT: ${perDay.size} days checked, ${bad.length} day(s) differ from the sheet${bad.length ? ":" : " (zero discrepancy)"}`);
    bad.slice(0, 30).forEach((l) => console.log("  " + l));
    for (const probe of ["2026-09-30"]) console.log(`  ${probe}: sheet=${perDay.get(probe) || 0} stored=${storedMap.get(probe) || 0}`);
    if (bad.length) process.exitCode = 1;
  }
  if (APPLY && after.get(today) !== csvToday) {
    console.log(`\nWARNING: today's dashboard (${after.get(today)}) still differs from CSV (${csvToday}).`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
