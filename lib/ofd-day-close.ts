/**
 * End-of-day OFD close pipeline. No CSV needed.
 *
 *   1. CAPTURE  - everything our webhooks recorded that day (plus the order's own OFD fields) is
 *                 turned into ledger rows and saved (open, source "webhook"). Runs from 23:50 IST,
 *                 and again as the first step of the close.
 *   2. VERIFY   - after midnight, every order that was active that day is checked against
 *                 Shiprocket's tracking history (/courier/track/awbs). Shiprocket's scans are merged
 *                 into webhook_events, so missed webhooks are recovered automatically.
 *   3. SEAL     - final rows are written (closed, source "verified"), every difference between what the
 *                 webhooks saw and what Shiprocket says is stored in ofd_day_closes, and the day is
 *                 never touched again.
 *
 * If Shiprocket can't be reached, the close is retried on the next runs; after 3 failed attempts the
 * day is sealed from webhook data alone and flagged as unverified.
 */
import type { PostgresDatabase, RuntimeEnv } from "./database";
import { toIndiaDate } from "./ofd-attempt";
import { getIndiaDate } from "./ofd-audit";
import { ensureOfdLedgerSchema, isDayClosed, writeLedgerRows, type LedgerOrder, type LedgerWrite } from "./ofd-ledger";
import { getShiprocketToken, syncTrackingHistories, type TrackingOrderRef } from "./shiprocket";

type Kind = "ofd" | "delivered" | "ndr" | "rto" | "other";

interface Ev {
  kind: Kind;
  status: string;
  at: string;
  day: string;
}

interface OrderRow {
  id: string | number;
  channel_order_id: string;
  awb: string;
  shipment_id: number | null;
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
}

interface DayResult {
  status: string;
  attempt: number;
}

const ORDER_COLS = `id, channel_order_id, awb, shipment_id, customer_name, customer_phone, customer_city, customer_state,
  courier, payment_method, total, shipped_at, shipping_cost, ndr_reason, ndr_raised_at, first_out_for_delivery_at,
  out_for_delivery_at, delivered_at, ndr_attempts, attempt_count, status`;

const indiaDateSql = (col: string) =>
  `(CASE WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN TO_CHAR(${col}::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') ELSE SUBSTR(${col}, 1, 10) END)`;

export async function ensureDayCloseSchema(db: PostgresDatabase) {
  await ensureOfdLedgerSchema(db);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ofd_day_closes (
        ofd_date TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        webhook_total INTEGER NOT NULL DEFAULT 0,
        final_total INTEGER NOT NULL DEFAULT 0,
        added INTEGER NOT NULL DEFAULT 0,
        removed INTEGER NOT NULL DEFAULT 0,
        changed INTEGER NOT NULL DEFAULT 0,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        verified_orders INTEGER NOT NULL DEFAULT 0,
        discrepancies_json TEXT NOT NULL DEFAULT '[]',
        error TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL DEFAULT '',
        sealed_at TEXT NOT NULL DEFAULT ''
      )`
    )
    .run()
    .catch(() => null);
}

const kindOf = (statusValue: string): Kind => {
  const s = statusValue.trim().toUpperCase();
  if (s === "OUT FOR DELIVERY") return "ofd";
  if (s.startsWith("RTO") || s.includes("RETURN TO ORIGIN")) return "rto";
  if (/UNDELIVERED|NDR/.test(s)) return "ndr";
  if (/^DELIVERED/.test(s)) return "delivered";
  return "other";
};

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

class OrderIndex {
  byId = new Set<string>();
  byAwb = new Map<string, string>();
  byChannel = new Map<string, string>();

  static async load(db: PostgresDatabase) {
    const idx = new OrderIndex();
    const rows = (await db.prepare("SELECT id, awb, channel_order_id FROM orders").all<{ id: string | number; awb: string; channel_order_id: string }>()).results;
    for (const r of rows) {
      const id = String(r.id);
      idx.byId.add(id);
      if (r.awb) idx.byAwb.set(String(r.awb).trim(), id);
      if (r.channel_order_id) idx.byChannel.set(String(r.channel_order_id).trim(), id);
    }
    return idx;
  }

  resolve(ev: { shiprocket_order_id?: unknown; awb?: unknown; channel_order_id?: unknown }): string | undefined {
    const sid = ev.shiprocket_order_id ? String(ev.shiprocket_order_id) : "";
    if (sid && this.byId.has(sid)) return sid;
    const awb = ev.awb ? String(ev.awb).trim() : "";
    if (awb && this.byAwb.has(awb)) return this.byAwb.get(awb);
    const ch = ev.channel_order_id ? String(ev.channel_order_id).trim() : "";
    if (ch && this.byChannel.has(ch)) return this.byChannel.get(ch);
    return undefined;
  }
}

/** Candidate orders that could have been out for delivery on `date`. */
async function candidateIds(db: PostgresDatabase, date: string, index: OrderIndex): Promise<Set<string>> {
  const ids = new Set<string>();

  // Everything the webhooks / tracking recorded that day.
  const evRows = (
    await db
      .prepare(
        `SELECT DISTINCT shiprocket_order_id, channel_order_id, awb FROM webhook_events
         WHERE ${indiaDateSql("COALESCE(NULLIF(event_at, ''), received_at)")} = ?`
      )
      .bind(date)
      .all<Record<string, unknown>>()
  ).results;
  for (const r of evRows) {
    const id = index.resolve(r);
    if (id) ids.add(id);
  }

  // Orders whose own OFD / delivery fields say they were active that day, plus orders that are
  // currently sitting at the destination / out / undelivered (a missed OFD webhook would hide there).
  const own = (
    await db
      .prepare(
        `SELECT id FROM orders WHERE
           ${indiaDateSql("out_for_delivery_at")} = ? OR ${indiaDateSql("first_out_for_delivery_at")} = ?
           OR ${indiaDateSql("delivered_at")} = ?
           OR UPPER(TRIM(status)) IN ('OUT FOR DELIVERY','IN TRANSIT-AT DESTINATION HUB','REACHED DESTINATION HUB','REACHED AT DESTINATION HUB')
           OR UPPER(TRIM(status)) LIKE 'UNDELIVERED%'`
      )
      .bind(date, date, date)
      .all<{ id: string | number }>()
  ).results;
  for (const r of own) ids.add(String(r.id));
  return ids;
}

async function loadOrders(db: PostgresDatabase, ids: string[]): Promise<Map<string, OrderRow>> {
  const out = new Map<string, OrderRow>();
  for (const group of chunks(ids, 500)) {
    const rows = (
      await db
        .prepare(`SELECT ${ORDER_COLS} FROM orders WHERE id IN (${group.map(() => "?").join(",")})`)
        .bind(...group)
        .all<OrderRow>()
    ).results;
    for (const r of rows) out.set(String(r.id), r);
  }
  return out;
}

async function loadEvents(db: PostgresDatabase, orders: Map<string, OrderRow>, index: OrderIndex): Promise<Map<string, Ev[]>> {
  const byOrder = new Map<string, Map<string, Ev>>();
  const add = (row: Record<string, unknown>) => {
    const id = index.resolve(row);
    if (!id || !orders.has(id)) return;
    const status = String(row.status || "").trim().toUpperCase();
    const at = String(row.at || "");
    if (!status || !at) return;
    const ev: Ev = { kind: kindOf(status), status, at, day: toIndiaDate(at) };
    if (!byOrder.has(id)) byOrder.set(id, new Map());
    byOrder.get(id)!.set(`${status}|${at}`, ev);
  };
  const select = `SELECT shiprocket_order_id, channel_order_id, awb, status, COALESCE(NULLIF(event_at, ''), received_at) AS at FROM webhook_events`;
  const awbs = [...orders.values()].map((o) => String(o.awb || "").trim()).filter(Boolean);
  for (const group of chunks(awbs, 400)) {
    const res = await db.prepare(`${select} WHERE awb IN (${group.map(() => "?").join(",")})`).bind(...group).all<Record<string, unknown>>();
    res.results.forEach(add);
  }
  for (const group of chunks([...orders.keys()], 400)) {
    const res = await db
      .prepare(`${select} WHERE shiprocket_order_id IN (${group.map(() => "?").join(",")})`)
      .bind(...group.map(Number))
      .all<Record<string, unknown>>();
    res.results.forEach(add);
  }
  const result = new Map<string, Ev[]>();
  for (const [id, m] of byOrder) result.set(id, [...m.values()].sort((a, b) => a.at.localeCompare(b.at)));
  return result;
}

/** What happened to one order on `date`, or null if it was not out for delivery that day. */
function evaluate(date: string, o: OrderRow, events: Ev[]): (DayResult & { ofdAt: string; deliveredAt: string; ndrReason: string; firstOfdAt: string }) | null {
  const ofdEvents = events.filter((e) => e.kind === "ofd");
  const ofdDays = [...new Set(ofdEvents.map((e) => e.day))].sort();
  let inDay = ofdDays.includes(date);
  let attempt = ofdDays.filter((d) => d <= date).length;

  // No OFD scan at all for this order: fall back to the order's own OFD fields.
  const noOfdScans = ofdEvents.length === 0;
  if (noOfdScans) {
    inDay = toIndiaDate(o.out_for_delivery_at) === date || toIndiaDate(o.first_out_for_delivery_at) === date;
    attempt = Math.max(1, Number(o.attempt_count || 0));
  }
  if (!inDay) return null;

  // Shiprocket's own attempt counter wins when this is the last known OFD day and it is higher.
  const lastDay = ofdDays.length ? ofdDays[ofdDays.length - 1] : date;
  if (lastDay <= date && Number(o.attempt_count || 0) > attempt) attempt = Number(o.attempt_count);
  attempt = Math.max(1, attempt);

  const dayEvents = events.filter((e) => e.day === date);
  const delivered = dayEvents.filter((e) => e.kind === "delivered").pop();
  const ndr = dayEvents.filter((e) => e.kind === "ndr").pop();
  const rto = dayEvents.filter((e) => e.kind === "rto").pop();

  let status = "UNRESOLVED AFTER OFD";
  let deliveredAt = "";
  if (delivered) {
    status = "DELIVERED";
    deliveredAt = delivered.at;
  } else if (ndr) {
    status = "UNDELIVERED";
  } else if (rto) {
    status = rto.status;
  } else if (noOfdScans && toIndiaDate(o.delivered_at) === date) {
    status = "DELIVERED";
    deliveredAt = o.delivered_at;
  } else if (noOfdScans && toIndiaDate(o.ndr_raised_at) === date) {
    status = "UNDELIVERED";
  }

  const ofdOnDay = ofdEvents.filter((e) => e.day === date).pop();
  const firstOfd = ofdEvents[0]?.at || o.first_out_for_delivery_at || "";
  return {
    status,
    attempt,
    ofdAt: ofdOnDay?.at || (toIndiaDate(o.out_for_delivery_at) === date ? o.out_for_delivery_at : `${date}T10:00:00+05:30`),
    deliveredAt: deliveredAt || (status === "DELIVERED" ? o.delivered_at : ""),
    ndrReason: status === "UNDELIVERED" ? o.ndr_reason || "" : "",
    firstOfdAt: firstOfd,
  };
}

interface DayBuild {
  rows: LedgerWrite[];
  summary: Map<string, DayResult>;
}

async function buildDay(db: PostgresDatabase, date: string, index: OrderIndex): Promise<DayBuild> {
  const ids = [...(await candidateIds(db, date, index))];
  const orders = await loadOrders(db, ids);
  const events = await loadEvents(db, orders, index);
  const rows: LedgerWrite[] = [];
  const summary = new Map<string, DayResult>();
  for (const [id, o] of orders) {
    const r = evaluate(date, o, events.get(id) || []);
    if (!r) continue;
    const order: LedgerOrder = {
      id: o.id,
      channelOrderId: String(o.channel_order_id || ""),
      customerName: String(o.customer_name || ""),
      customerPhone: String(o.customer_phone || ""),
      customerCity: String(o.customer_city || ""),
      customerState: String(o.customer_state || ""),
      status: r.status,
      paymentMethod: String(o.payment_method || ""),
      total: Number(o.total || 0),
      awb: String(o.awb || ""),
      courier: String(o.courier || ""),
      shippedAt: String(o.shipped_at || ""),
      firstOutForDeliveryAt: r.firstOfdAt,
      outForDeliveryAt: r.ofdAt,
      deliveredAt: r.deliveredAt,
      ndrReason: r.ndrReason,
      ndrAttempts: Number(o.ndr_attempts || 0),
      ndrRaisedAt: r.status === "UNDELIVERED" ? `${date}T00:00:00+05:30` : "",
      shippingCost: Number(o.shipping_cost || 0),
      recordedOfdDays: r.attempt,
      attemptNumber: r.attempt,
      attemptCount: r.attempt,
      previousUndelivered: r.attempt > 1,
      webhookCount: (events.get(id) || []).filter((e) => e.day === date).length,
      eventsLog: (events.get(id) || [])
        .filter((e) => e.day === date)
        .map((e) => ({ status: e.status, eventAt: e.at, source: "webhook" })),
      verifiedStatus: "pending",
      notes: "",
    };
    rows.push({ date, order });
    summary.set(String(o.id), { status: r.status, attempt: r.attempt });
  }
  return { rows, summary };
}

async function readState(db: PostgresDatabase, date: string) {
  return db.prepare("SELECT * FROM ofd_day_closes WHERE ofd_date = ?").bind(date).first<Record<string, unknown>>().catch(() => null);
}

async function setState(db: PostgresDatabase, date: string, fields: Record<string, unknown>) {
  const cols = Object.keys(fields);
  await db
    .prepare(
      `INSERT INTO ofd_day_closes (ofd_date, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})
       ON CONFLICT (ofd_date) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
    )
    .bind(date, ...cols.map((c) => fields[c]))
    .run();
}

export interface CloseOptions {
  /** Verify against Shiprocket (default true). */
  verify?: boolean;
  /** Re-close a day that is already sealed (overwrites it). */
  force?: boolean;
  /** Stop verifying after this many ms (rest falls back to webhook data). */
  verifyBudgetMs?: number;
}

/** Step 1: save what the webhooks gave us for `date` (open rows, source "webhook"). */
export async function captureDay(db: PostgresDatabase, date: string, index?: OrderIndex) {
  await ensureDayCloseSchema(db);
  const idx = index || (await OrderIndex.load(db));
  const built = await buildDay(db, date, idx);
  await writeLedgerRows(db, built.rows, { mode: "seal", closed: false, source: "webhook" });
  await setState(db, date, {
    state: "captured",
    webhook_total: built.rows.length,
    captured_at: new Date().toISOString(),
  });
  return built;
}

/** Steps 1-3 for a passed day. Idempotent: a sealed day is skipped unless `force`. */
export async function closeDay(runtime: RuntimeEnv, date: string, opts: CloseOptions = {}) {
  const db = runtime.DB;
  await ensureDayCloseSchema(db);
  if (date >= getIndiaDate()) return { date, skipped: "day not finished" as const };

  const state = await readState(db, date);
  if (!opts.force) {
    if (state?.state === "sealed") return { date, skipped: "already sealed" as const };
    if (await isDayClosed(db, date)) {
      // Sealed earlier (e.g. from a CSV): just record it.
      await setState(db, date, { state: "sealed", verified: true, sealed_at: new Date().toISOString(), error: "sealed from CSV import" });
      return { date, skipped: "already sealed (csv)" as const };
    }
    const started = Date.parse(String(state?.started_at || ""));
    if (state?.state === "running" && Number.isFinite(started) && Date.now() - started < 20 * 60 * 1000) {
      return { date, skipped: "close already running" as const };
    }
  }

  const attempts = Number(state?.attempts || 0) + 1;
  await setState(db, date, { state: "running", attempts, started_at: new Date().toISOString(), error: "" });

  try {
    const index = await OrderIndex.load(db);

    // 1. CAPTURE what the webhooks saw.
    const captured = await captureDay(db, date, index);
    await setState(db, date, { state: "running" });

    // 2. VERIFY against Shiprocket.
    let verified = false;
    let verifiedOrders = 0;
    let verifyError = "";
    if (opts.verify !== false) {
      try {
        const token = await getShiprocketToken(runtime);
        const ids = [...(await candidateIds(db, date, index))];
        const orders = await loadOrders(db, ids);
        const refs: TrackingOrderRef[] = [...orders.values()]
          .filter((o) => o.awb)
          .map((o) => ({ id: Number(o.id), channelOrderId: String(o.channel_order_id || ""), shipmentId: o.shipment_id ? Number(o.shipment_id) : null, awb: String(o.awb) }));
        const deadline = Date.now() + (opts.verifyBudgetMs ?? 200_000);
        for (const group of chunks(refs, 250)) {
          if (Date.now() > deadline) throw new Error(`verification budget exhausted after ${verifiedOrders}/${refs.length} orders`);
          await syncTrackingHistories(db, token, group);
          verifiedOrders += group.length;
        }
        verified = true;
      } catch (error) {
        verifyError = error instanceof Error ? error.message : String(error);
      }
    }

    if (opts.verify !== false && !verified && attempts < 3) {
      // Retry on a later run; the open webhook rows stay in place meanwhile.
      await setState(db, date, { state: "verify_failed", error: verifyError, verified_orders: verifiedOrders });
      return { date, state: "verify_failed" as const, error: verifyError, attempts };
    }

    // 3. SEAL the final data.
    const final = await buildDay(db, date, index);
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const changed: unknown[] = [];
    for (const [id, f] of final.summary) {
      const c = captured.summary.get(id);
      const ch = final.rows.find((r) => String(r.order.id) === id)?.order.channelOrderId;
      if (!c) added.push({ order: ch || id, status: f.status, attempt: f.attempt });
      else if (c.status !== f.status || c.attempt !== f.attempt)
        changed.push({ order: ch || id, webhook: c, shiprocket: f });
    }
    for (const [id, c] of captured.summary) {
      if (!final.summary.has(id)) {
        const ch = captured.rows.find((r) => String(r.order.id) === id)?.order.channelOrderId;
        removed.push({ order: ch || id, webhook: c });
      }
    }

    const source = verified ? "verified" : "webhook";
    await writeLedgerRows(db, final.rows, { mode: "seal", closed: true, source, force: opts.force });
    // Rows from the capture step that Shiprocket did not confirm are dropped.
    const keep = new Set(final.rows.map((r) => String(r.order.id)));
    const open = (await db.prepare("SELECT id, order_id FROM ofd_ledger WHERE ofd_date = ? AND closed = FALSE").bind(date).all<{ id: number | string; order_id: number | string }>()).results;
    for (const r of open) if (!keep.has(String(r.order_id))) await db.prepare("DELETE FROM ofd_ledger WHERE id = ?").bind(r.id).run();
    await db.prepare("DELETE FROM analytics_cache WHERE cache_key = ?").bind(`today_ofd_${date}`).run().catch(() => null);

    const details = [
      ...added.map((d) => ({ type: "added_by_shiprocket", ...(d as object) })),
      ...removed.map((d) => ({ type: "not_confirmed_by_shiprocket", ...(d as object) })),
      ...changed.map((d) => ({ type: "changed", ...(d as object) })),
    ].slice(0, 300);
    await setState(db, date, {
      state: "sealed",
      webhook_total: captured.rows.length,
      final_total: final.rows.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      verified,
      verified_orders: verifiedOrders,
      discrepancies_json: JSON.stringify(details),
      error: verified ? "" : `sealed from webhook data only: ${verifyError || "verification skipped"}`,
      sealed_at: new Date().toISOString(),
    });
    return {
      date,
      state: "sealed" as const,
      verified,
      webhook: captured.rows.length,
      final: final.rows.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setState(db, date, { state: "failed", error: message });
    throw error;
  }
}

/**
 * Called from the cron. Cheap when there is nothing to do.
 *  - from 23:50 IST: save today's webhook data (throttled to once per 5 minutes)
 *  - closes (verify + seal) every unsealed day of the last 7 days, oldest first
 */
export async function runDayCloseCycle(runtime: RuntimeEnv) {
  const db = runtime.DB;
  await ensureDayCloseSchema(db);
  const today = getIndiaDate();
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  const results: unknown[] = [];

  if (hour === 23 && minute >= 50) {
    const st = await readState(db, today);
    const last = Date.parse(String(st?.captured_at || ""));
    if (!Number.isFinite(last) || Date.now() - last > 5 * 60 * 1000) {
      const b = await captureDay(db, today);
      results.push({ date: today, captured: b.rows.length });
    }
  }

  for (let back = 7; back >= 1; back--) {
    const d = getIndiaDate(new Date(new Date(`${today}T12:00:00+05:30`).getTime() - back * 24 * 60 * 60 * 1000));
    const st = await readState(db, d);
    if (st?.state === "sealed") continue;
    results.push(await closeDay(runtime, d));
  }
  return results;
}

/** Read-only: what the pipeline would currently produce for `date` (no ledger / state writes). */
export async function previewDay(db: PostgresDatabase, date: string) {
  const index = await OrderIndex.load(db);
  return buildDay(db, date, index);
}

/** Read-only helper for tests: the Shiprocket references the verify step would check for `date`. */
export async function verificationRefs(db: PostgresDatabase, date: string): Promise<TrackingOrderRef[]> {
  const index = await OrderIndex.load(db);
  const orders = await loadOrders(db, [...(await candidateIds(db, date, index))]);
  return [...orders.values()]
    .filter((o) => o.awb)
    .map((o) => ({ id: Number(o.id), channelOrderId: String(o.channel_order_id || ""), shipmentId: o.shipment_id ? Number(o.shipment_id) : null, awb: String(o.awb) }));
}
