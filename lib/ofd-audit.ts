import type { PostgresDatabase } from "./database";
import { logActivity } from "./database";
import { loadOfdRecords } from "./ofd";
import fs from "fs";
import path from "path";


export interface AuditTableRow {
  id?: number | string;
  ofd_date?: string;
  order_id?: string;
  channel_order_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_city?: string;
  customer_state?: string;
  courier?: string;
  awb?: string;
  payment_method?: string;
  total?: number;
  initial_ofd_time?: string;
  latest_ofd_time?: string;
  current_status?: string;
  delivery_outcome?: string;
  delivered_at?: string;
  attempt_number?: number;
  ndr_reason?: string;
  ndr_attempts?: number;
  webhook_count?: number;
  last_webhook_at?: string;
  events_log_json?: string;
  verified_status?: string;
  verified_by?: string;
  verified_at?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OfdAuditRecord {
  id: string;
  ofdDate: string;
  orderId: string;
  channelOrderId: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerState: string;
  courier: string;
  awb: string;
  paymentMethod: string;
  total: number;
  initialOfdTime: string;
  latestOfdTime: string;
  currentStatus: string;
  deliveryOutcome: "delivered" | "still_ofd" | "undelivered" | "rto" | "unresolved";
  deliveredAt: string;
  attemptNumber: number;
  ndrReason: string;
  ndrAttempts: number;
  webhookCount: number;
  lastWebhookAt: string;
  eventsLogJson: string;
  verifiedStatus: "pending" | "verified" | "discrepant";
  verifiedBy: string;
  verifiedAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export function getIndiaDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getIndiaTime(isoString?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return isoString;
  }
}

export async function ensureOfdAuditSchema(db: PostgresDatabase) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS today_ofd_audit (
      id BIGSERIAL PRIMARY KEY,
      ofd_date TEXT NOT NULL,
      order_id BIGINT NOT NULL,
      channel_order_id TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      customer_city TEXT NOT NULL DEFAULT '',
      customer_state TEXT NOT NULL DEFAULT '',
      courier TEXT NOT NULL DEFAULT '',
      awb TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '',
      total REAL NOT NULL DEFAULT 0,
      initial_ofd_time TEXT NOT NULL DEFAULT '',
      latest_ofd_time TEXT NOT NULL DEFAULT '',
      current_status TEXT NOT NULL DEFAULT 'OUT FOR DELIVERY',
      delivery_outcome TEXT NOT NULL DEFAULT 'still_ofd',
      delivered_at TEXT NOT NULL DEFAULT '',
      attempt_number INTEGER NOT NULL DEFAULT 1,
      ndr_reason TEXT NOT NULL DEFAULT '',
      ndr_attempts INTEGER NOT NULL DEFAULT 0,
      webhook_count INTEGER NOT NULL DEFAULT 0,
      last_webhook_at TEXT NOT NULL DEFAULT '',
      events_log_json TEXT NOT NULL DEFAULT '[]',
      verified_status TEXT NOT NULL DEFAULT 'pending',
      verified_by TEXT NOT NULL DEFAULT '',
      verified_at TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(ofd_date, order_id)
    )
  `).run().catch(() => null);

  await db.prepare("CREATE INDEX IF NOT EXISTS idx_today_ofd_audit_date ON today_ofd_audit(ofd_date, delivery_outcome)").run().catch(() => null);
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_today_ofd_audit_order ON today_ofd_audit(order_id)").run().catch(() => null);
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_today_ofd_audit_channel ON today_ofd_audit(channel_order_id)").run().catch(() => null);
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_today_ofd_audit_awb ON today_ofd_audit(awb)").run().catch(() => null);
}

/**
 * Categorizes an order's delivery status into an outcome:
 * - delivered: successfully delivered
 * - still_ofd: currently out with delivery agent
 * - undelivered: delivery attempt failed / NDR
 * - rto: returning or returned to origin
 * - unresolved: end of day, no final status scan
 */
export function determineDeliveryOutcome(
  status: string,
  deliveredAt: string,
  targetDate: string,
  ndrRaisedAt = ""
): "delivered" | "still_ofd" | "undelivered" | "rto" | "unresolved" {
  const normStatus = (status || "").trim().toUpperCase();
  
  if (/^DELIVERED(?: TO CUSTOMER)?$/i.test(normStatus) || (deliveredAt && deliveredAt.startsWith(targetDate))) {
    return "delivered";
  }
  if (normStatus.startsWith("RTO") || normStatus.includes("RETURN TO ORIGIN")) {
    return "rto";
  }
  if (
    /UNDELIVERED|NDR/i.test(normStatus) ||
    (ndrRaisedAt && ndrRaisedAt.startsWith(targetDate))
  ) {
    return "undelivered";
  }
  if (/^OUT FOR DELIVERY$/i.test(normStatus)) {
    const today = getIndiaDate();
    if (targetDate < today) {
      return "unresolved"; // If from a past date and still marked OFD, it's unresolved
    }
    return "still_ofd";
  }
  return "still_ofd";
}

/**
 * Synchronizes today's OFD records from orders & webhook_events into today_ofd_audit table.
 */
export async function syncTodayOfdAudit(
  db: PostgresDatabase,
  targetDate: string = getIndiaDate()
) {
  await ensureOfdAuditSchema(db);
  const now = new Date().toISOString();

  // 1. Fetch all OFD records for targetDate using optimized loadOfdRecords
  const ofdResult = await loadOfdRecords(db, targetDate);
  const orderList = ofdResult.results || [];

  if (orderList.length === 0) {
    return { targetDate, total: 0, delivered: 0, stillOfd: 0, undelivered: 0, rto: 0, webhookCount: 0 };
  }

  // 2. Fetch all webhook events for targetDate
  const indiaDateSql = (col: string) =>
    `(CASE WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN TO_CHAR(${col}::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') ELSE SUBSTR(${col}, 1, 10) END)`;

  const webhooksRes = await db.prepare(`
    SELECT shiprocket_order_id, channel_order_id, awb, status, event_at, received_at
    FROM webhook_events
    WHERE ${indiaDateSql("COALESCE(NULLIF(event_at, ''), received_at)")} = ?
    ORDER BY id ASC
  `).bind(targetDate).all<Record<string, unknown>>().catch(() => ({ results: [] }));

  const webhooksByOrder = new Map<string, Record<string, unknown>[]>();
  for (const ev of (webhooksRes.results || [])) {
    const keys = [
      ev.shiprocket_order_id ? String(ev.shiprocket_order_id) : "",
      ev.channel_order_id ? String(ev.channel_order_id).trim() : "",
      ev.awb ? String(ev.awb).trim() : "",
    ].filter(Boolean);

    for (const key of keys) {
      if (!webhooksByOrder.has(key)) webhooksByOrder.set(key, []);
      webhooksByOrder.get(key)!.push(ev);
    }
  }

  let totalDelivered = 0;
  let totalStillOfd = 0;
  let totalUndelivered = 0;
  let totalRto = 0;
  let totalWebhooks = 0;
  const preparedValues: unknown[][] = [];

  for (const o of orderList) {
    const oIdStr = String(o.id);
    const relatedWebhooks = [
      ...(webhooksByOrder.get(oIdStr) || []),
      ...(o.channelOrderId ? (webhooksByOrder.get(String(o.channelOrderId)) || []) : []),
      ...(o.awb ? (webhooksByOrder.get(String(o.awb)) || []) : []),
    ];

    // Deduplicate webhooks for this order by event_at + status
    const seenEventKeys = new Set<string>();
    const deduplicatedEvents = [];
    for (const w of relatedWebhooks) {
      const k = `${w.status}-${w.event_at || w.received_at}`;
      if (!seenEventKeys.has(k)) {
        seenEventKeys.add(k);
        deduplicatedEvents.push({
          status: w.status,
          eventAt: w.event_at || w.received_at,
          receivedAt: w.received_at,
          source: "webhook",
        });
      }
    }

    const webhookCount = deduplicatedEvents.length;
    totalWebhooks += webhookCount;

    const initialOfd = (o.firstOutForDeliveryAt && String(o.firstOutForDeliveryAt).startsWith(targetDate))
      ? String(o.firstOutForDeliveryAt)
      : (o.outForDeliveryAt ? String(o.outForDeliveryAt) : now);
    const latestOfd = o.outForDeliveryAt ? String(o.outForDeliveryAt) : initialOfd;

    // Determine current status and outcome
    const currentStatus = String(o.status || "OUT FOR DELIVERY");
    const deliveredAt = String(o.deliveredAt || "");
    const ndrRaisedAt = String(o.ndrRaisedAt || "");

    const outcome = determineDeliveryOutcome(currentStatus, deliveredAt, targetDate, ndrRaisedAt);
    if (outcome === "delivered") totalDelivered++;
    else if (outcome === "still_ofd") totalStillOfd++;
    else if (outcome === "undelivered") totalUndelivered++;
    else if (outcome === "rto") totalRto++;

    // Calculate attempt number: If first OFD date was before targetDate, it's at least attempt 2
    let attemptNumber = Number(o.attemptNumber || 0);
    if (!attemptNumber) {
      const firstOfdDate = o.firstOutForDeliveryAt ? String(o.firstOutForDeliveryAt).slice(0, 10) : "";
      if (firstOfdDate && firstOfdDate < targetDate) {
        const ndrAttempts = Number(o.ndrAttempts || 0);
        attemptNumber = Math.max(2, ndrAttempts + (outcome === "undelivered" ? 0 : 1));
      } else {
        attemptNumber = 1;
      }
    }

    preparedValues.push([
      targetDate,
      o.id,
      o.channelOrderId || "",
      o.customerName || "",
      o.customerPhone || "",
      o.customerCity || "",
      o.customerState || "",
      o.courier || "",
      o.awb || "",
      o.paymentMethod || "",
      Number(o.total || 0),
      initialOfd,
      latestOfd,
      currentStatus,
      outcome,
      deliveredAt,
      attemptNumber,
      o.ndrReason || "",
      Number(o.ndrAttempts || 0),
      webhookCount,
      deduplicatedEvents.at(-1)?.eventAt || "",
      JSON.stringify(deduplicatedEvents),
      now,
      now,
    ]);
  }

  // Chunked batch upsert in batches of 20
  const CHUNK_SIZE = 20;
  for (let i = 0; i < preparedValues.length; i += CHUNK_SIZE) {
    const chunk = preparedValues.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const flattened = chunk.flat();

    await db.prepare(`
      INSERT INTO today_ofd_audit (
        ofd_date, order_id, channel_order_id, customer_name, customer_phone,
        customer_city, customer_state, courier, awb, payment_method, total,
        initial_ofd_time, latest_ofd_time, current_status, delivery_outcome,
        delivered_at, attempt_number, ndr_reason, ndr_attempts, webhook_count,
        last_webhook_at, events_log_json, created_at, updated_at
      ) VALUES ${placeholders}
      ON CONFLICT(ofd_date, order_id) DO UPDATE SET
        channel_order_id = EXCLUDED.channel_order_id,
        customer_name = EXCLUDED.customer_name,
        customer_phone = CASE WHEN today_ofd_audit.customer_phone = '' THEN EXCLUDED.customer_phone ELSE today_ofd_audit.customer_phone END,
        customer_city = EXCLUDED.customer_city,
        customer_state = EXCLUDED.customer_state,
        courier = EXCLUDED.courier,
        awb = EXCLUDED.awb,
        payment_method = EXCLUDED.payment_method,
        total = EXCLUDED.total,
        initial_ofd_time = CASE WHEN today_ofd_audit.initial_ofd_time = '' THEN EXCLUDED.initial_ofd_time ELSE today_ofd_audit.initial_ofd_time END,
        latest_ofd_time = EXCLUDED.latest_ofd_time,
        current_status = EXCLUDED.current_status,
        delivery_outcome = EXCLUDED.delivery_outcome,
        delivered_at = EXCLUDED.delivered_at,
        attempt_number = EXCLUDED.attempt_number,
        ndr_reason = EXCLUDED.ndr_reason,
        ndr_attempts = EXCLUDED.ndr_attempts,
        webhook_count = CASE WHEN EXCLUDED.webhook_count > today_ofd_audit.webhook_count THEN EXCLUDED.webhook_count ELSE today_ofd_audit.webhook_count END,
        last_webhook_at = CASE WHEN EXCLUDED.last_webhook_at != '' THEN EXCLUDED.last_webhook_at ELSE today_ofd_audit.last_webhook_at END,
        events_log_json = CASE WHEN EXCLUDED.events_log_json != '[]' THEN EXCLUDED.events_log_json ELSE today_ofd_audit.events_log_json END,
        updated_at = EXCLUDED.updated_at
    `).bind(...flattened).run();
  }

  // Also auto-save EOD file to outputs
  try {
    await saveEodExportToFile(db, targetDate);
  } catch {
    // Ignore file write error if in read-only environment
  }

  return {
    targetDate,
    total: orderList.length,
    delivered: totalDelivered,
    stillOfd: totalStillOfd,
    undelivered: totalUndelivered,
    rto: totalRto,
    webhookCount: totalWebhooks,
  };
}

/**
 * When a webhook arrives, record it immediately into today_ofd_audit if relevant.
 */
export async function recordOfdWebhookArrival(
  db: PostgresDatabase,
  event: {
    shiprocketOrderId?: number | null;
    channelOrderId?: string | null;
    shipmentId?: number | null;
    awb?: string | null;
    status: string;
    eventAt: string;
    payload?: Record<string, unknown>;
  }
) {
  await ensureOfdAuditSchema(db);
  const targetDate = getIndiaDate();
  const now = new Date().toISOString();
  const status = (event.status || "").trim().toUpperCase();

  const isDelivered = /^DELIVERED(?: TO CUSTOMER)?$/i.test(status);
  const isOfd = /^OUT FOR DELIVERY$/i.test(status);
  const isUndelivered = /UNDELIVERED|NDR/i.test(status);
  const isRto = status.startsWith("RTO");

  // Lookup matching order in today_ofd_audit
  let existingAudit: AuditTableRow | null = null;
  if (event.shiprocketOrderId) {
    existingAudit = await db.prepare("SELECT * FROM today_ofd_audit WHERE ofd_date = ? AND order_id = ?").bind(targetDate, event.shiprocketOrderId).first();
  }
  if (!existingAudit && event.channelOrderId) {
    existingAudit = await db.prepare("SELECT * FROM today_ofd_audit WHERE ofd_date = ? AND channel_order_id = ?").bind(targetDate, event.channelOrderId).first();
  }
  if (!existingAudit && event.awb) {
    existingAudit = await db.prepare("SELECT * FROM today_ofd_audit WHERE ofd_date = ? AND awb = ?").bind(targetDate, event.awb).first();
  }

  // If not in today_ofd_audit yet, check if this is an OFD event
  if (!existingAudit && (isOfd || isDelivered || isUndelivered || isRto)) {
    await syncTodayOfdAudit(db, targetDate);
    return;
  }

  if (existingAudit) {
    const outcome = isDelivered ? "delivered" : isRto ? "rto" : isUndelivered ? "undelivered" : "still_ofd";
    const deliveredAt = isDelivered ? (event.eventAt || now) : existingAudit.delivered_at;
    const ndrReason = isUndelivered ? String(event.payload?.reason || event.payload?.ndr_reason || existingAudit.ndr_reason) : existingAudit.ndr_reason;

    let events: Record<string, unknown>[] = [];
    try {
      events = JSON.parse(existingAudit.events_log_json || "[]");
    } catch {
      events = [];
    }
    events.push({
      status: event.status,
      eventAt: event.eventAt || now,
      receivedAt: now,
      source: "webhook_live",
    });

    await db.prepare(`
      UPDATE today_ofd_audit SET
        current_status = ?,
        delivery_outcome = ?,
        delivered_at = ?,
        ndr_reason = ?,
        webhook_count = webhook_count + 1,
        last_webhook_at = ?,
        events_log_json = ?,
        latest_ofd_time = CASE WHEN ? = 'OUT FOR DELIVERY' THEN ? ELSE latest_ofd_time END,
        updated_at = ?
      WHERE id = ?
    `).bind(
      event.status,
      outcome,
      deliveredAt,
      ndrReason,
      event.eventAt || now,
      JSON.stringify(events),
      status,
      event.eventAt || now,
      now,
      existingAudit.id
    ).run();

    await logActivity(db, "OFD Audit", "ofd.audit.updated", `Updated OFD audit for order ${existingAudit.channel_order_id || existingAudit.order_id}: ${status}`, {
      orderId: existingAudit.order_id,
      channelOrderId: existingAudit.channel_order_id,
      status: event.status,
      outcome,
    });
  }
}

/**
 * Generates CSV string of the audit records for a given date.
 */
export async function generateOfdAuditCsv(
  db: PostgresDatabase,
  targetDate: string = getIndiaDate()
): Promise<string> {
  await ensureOfdAuditSchema(db);

  const res = await db.prepare(`
    SELECT * FROM today_ofd_audit
    WHERE ofd_date = ?
    ORDER BY 
      CASE delivery_outcome
        WHEN 'delivered' THEN 1
        WHEN 'still_ofd' THEN 2
        WHEN 'undelivered' THEN 3
        WHEN 'rto' THEN 4
        ELSE 5
      END,
      id DESC
  `).bind(targetDate).all<AuditTableRow>();

  const records = res.results || [];

  const headers = [
    "Order ID",
    "Channel Order ID",
    "Customer Name",
    "Customer Phone",
    "City",
    "State",
    "Courier",
    "AWB",
    "Payment Method",
    "Order Total (INR)",
    "Initial OFD Time (IST)",
    "Latest OFD Time (IST)",
    "Current Status",
    "Delivery Outcome",
    "Delivered At (IST)",
    "Attempt Number",
    "NDR Reason",
    "Webhook Count",
    "Last Webhook Time",
    "Manual Verification",
    "Audit Notes",
  ];

  const escapeCsv = (val: unknown) => {
    if (val == null) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const lines = [headers.join(",")];
  for (const r of records) {
    const line = [
      escapeCsv(r.order_id),
      escapeCsv(r.channel_order_id),
      escapeCsv(r.customer_name),
      escapeCsv(r.customer_phone),
      escapeCsv(r.customer_city),
      escapeCsv(r.customer_state),
      escapeCsv(r.courier),
      escapeCsv(r.awb),
      escapeCsv(r.payment_method?.toUpperCase()),
      Number(r.total || 0).toFixed(2),
      escapeCsv(getIndiaTime(r.initial_ofd_time)),
      escapeCsv(getIndiaTime(r.latest_ofd_time)),
      escapeCsv(r.current_status),
      escapeCsv(r.delivery_outcome?.toUpperCase()),
      escapeCsv(getIndiaTime(r.delivered_at)),
      r.attempt_number || 1,
      escapeCsv(r.ndr_reason),
      r.webhook_count || 0,
      escapeCsv(getIndiaTime(r.last_webhook_at)),
      escapeCsv(r.verified_status?.toUpperCase()),
      escapeCsv(r.notes),
    ];
    lines.push(line.join(","));
  }

  return lines.join("\n");
}

/**
 * Saves daily OFD report to disk in outputs/ofd-exports/
 */
export async function saveEodExportToFile(
  db: PostgresDatabase,
  targetDate: string = getIndiaDate()
): Promise<string> {
  const csv = await generateOfdAuditCsv(db, targetDate);
  const outDir = path.resolve(process.cwd(), "outputs/ofd-exports");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const filePath = path.join(outDir, `ofd-audit-${targetDate}.csv`);
  fs.writeFileSync(filePath, csv, "utf-8");
  return filePath;
}
