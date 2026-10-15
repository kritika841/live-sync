/**
 * ofd_ledger: permanent, per-day record of every order that went out for delivery.
 *
 * A day that has passed is CLOSED: its rows are written once and are never touched by live
 * syncs, webhooks or cache refreshes. Only an explicit CSV re-ingest with force can override.
 */
import type { PostgresDatabase } from "./database";

export type LedgerOrder = Record<string, unknown> & {
  id: number | string;
  channelOrderId?: string;
  awb?: string;
  status: string;
  attemptNumber: number;
  outForDeliveryAt?: string;
};

export type LedgerSource = "csv" | "live" | "webhook" | "verified";

export async function ensureOfdLedgerSchema(db: PostgresDatabase) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ofd_ledger (
        id BIGSERIAL PRIMARY KEY,
        ofd_date TEXT NOT NULL,
        order_id BIGINT NOT NULL,
        channel_order_id TEXT NOT NULL DEFAULT '',
        awb TEXT NOT NULL DEFAULT '',
        attempt_number INTEGER NOT NULL DEFAULT 1,
        final_status TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'live',
        closed BOOLEAN NOT NULL DEFAULT TRUE,
        record_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(ofd_date, order_id)
      )`
    )
    .run()
    .catch(() => null);
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_ofd_ledger_date ON ofd_ledger(ofd_date)").run().catch(() => null);
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_ofd_ledger_channel ON ofd_ledger(channel_order_id)").run().catch(() => null);
}

/** True when a closed ledger exists for the day. */
export async function isDayClosed(db: PostgresDatabase, date: string): Promise<boolean> {
  await ensureOfdLedgerSchema(db);
  const row = await db
    .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN closed THEN 1 ELSE 0 END) AS closed FROM ofd_ledger WHERE ofd_date = ?")
    .bind(date)
    .first<{ total: number | string; closed: number | string | null }>()
    .catch(() => null);
  const total = Number(row?.total || 0);
  return total > 0 && Number(row?.closed || 0) === total;
}

/** Orders of a closed day exactly as they were stored; null if the day is not closed. */
export async function readClosedDay(db: PostgresDatabase, date: string): Promise<LedgerOrder[] | null> {
  if (!(await isDayClosed(db, date))) return null;
  const res = await db
    .prepare("SELECT record_json FROM ofd_ledger WHERE ofd_date = ?")
    .bind(date)
    .all<{ record_json: string }>();
  const orders: LedgerOrder[] = [];
  for (const r of res.results || []) {
    try {
      orders.push(JSON.parse(r.record_json) as LedgerOrder);
    } catch {
      // skip unreadable row
    }
  }
  orders.sort(
    (a, b) =>
      String(b.outForDeliveryAt || "").localeCompare(String(a.outForDeliveryAt || "")) ||
      Number(b.id) - Number(a.id)
  );
  return orders;
}

export interface LedgerWrite {
  date: string;
  order: LedgerOrder;
}

const COLS = 11;

/**
 * Writes ledger rows in batches.
 *  - mode "snapshot": insert only; existing rows are never modified (used when closing a day from live data)
 *  - mode "csv" / "seal": replaces open rows and live/webhook-sourced rows. Rows already sealed from a
 *    CSV or from a Shiprocket-verified close are only replaced when `force` is set.
 */
export async function writeLedgerRows(
  db: PostgresDatabase,
  rows: LedgerWrite[],
  opts: { mode: "snapshot" | "csv" | "seal"; closed: boolean; force?: boolean; source?: LedgerSource }
): Promise<number> {
  await ensureOfdLedgerSchema(db);
  const now = new Date().toISOString();
  const source: LedgerSource = opts.source ?? (opts.mode === "csv" ? "csv" : "live");
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => `(${new Array(COLS).fill("?").join(", ")})`).join(", ");
    const values = chunk.flatMap(({ date, order }) => [
      date,
      order.id,
      String(order.channelOrderId || ""),
      String(order.awb || ""),
      Number(order.attemptNumber || 1),
      String(order.status || ""),
      source,
      opts.closed,
      JSON.stringify(order),
      now,
      now,
    ]);
    const conflict =
      opts.mode === "snapshot"
        ? "ON CONFLICT (ofd_date, order_id) DO NOTHING"
        : `ON CONFLICT (ofd_date, order_id) DO UPDATE SET
             channel_order_id = EXCLUDED.channel_order_id, awb = EXCLUDED.awb,
             attempt_number = EXCLUDED.attempt_number, final_status = EXCLUDED.final_status,
             source = EXCLUDED.source, closed = EXCLUDED.closed, record_json = EXCLUDED.record_json,
             updated_at = EXCLUDED.updated_at
           WHERE ${opts.force ? "TRUE" : "(ofd_ledger.closed = FALSE OR ofd_ledger.source IN ('live', 'webhook'))"}`;
    await db
      .prepare(
        `INSERT INTO ofd_ledger (ofd_date, order_id, channel_order_id, awb, attempt_number, final_status, source, closed, record_json, created_at, updated_at)
         VALUES ${placeholders} ${conflict}`
      )
      .bind(...values)
      .run();
  }
  return rows.length;
}

/**
 * Freezes a day from the live-computed orders. Does nothing if the day already has rows,
 * so a closed day can never be overwritten by a later live recomputation.
 */
export async function closeDayFromLive(db: PostgresDatabase, date: string, orders: LedgerOrder[]) {
  if (orders.length === 0) return 0;
  await writeLedgerRows(
    db,
    orders.map((order) => ({ date, order })),
    { mode: "snapshot", closed: true }
  );
  return orders.length;
}
