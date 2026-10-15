import type { PostgresDatabase } from "./database";
import { deriveOrderAttemptNumber } from "./ofd-attempt";

const ndrSql = "(UPPER(TRIM(status)) IN ('UNDELIVERED', 'NDR', 'NDR PENDING') OR UPPER(TRIM(status)) LIKE 'UNDELIVERED%')";
const indiaDateSql = (column: string) =>
  `(CASE WHEN ${column} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN TO_CHAR(${column}::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') ELSE SUBSTR(${column}, 1, 10) END)`;
const latestOfdDateSql = indiaDateSql("out_for_delivery_at");
const firstOfdDateSql = indiaDateSql("first_out_for_delivery_at");
const deliveredDateSql = indiaDateSql("delivered_at");

export interface OfdOrderRecord {
  id: number | string;
  channelOrderId: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerState: string;
  status: string;
  paymentMethod: string;
  total: number;
  awb: string;
  courier: string;
  shippedAt: string;
  firstOutForDeliveryAt: string;
  outForDeliveryAt: string;
  deliveredAt: string;
  ndrReason: string;
  ndrAttempts: number;
  ndrRaisedAt: string;
  shippingCost: number;
  recordedOfdDays: number;
  attemptNumber: number;
  attemptCount?: number;
  previousUndelivered: boolean;
  latestKnownStatus?: string;
  [key: string]: unknown;
}

export async function loadOfdRecords(
  db: PostgresDatabase,
  selectedDate: string
): Promise<{ results: OfdOrderRecord[] }> {
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const res = await db
    .prepare(
      `
      WITH event_orders AS (
        SELECT o.id AS order_id, e.id AS event_id FROM orders o JOIN webhook_events e ON e.shiprocket_order_id = o.id
        UNION
        SELECT o.id, e.id FROM orders o JOIN webhook_events e ON e.shipment_id = o.shipment_id
        UNION
        SELECT o.id, e.id FROM orders o JOIN webhook_events e ON e.awb = o.awb WHERE e.awb <> ''
        UNION
        SELECT o.id, e.id FROM orders o JOIN webhook_events e ON e.channel_order_id = o.channel_order_id WHERE e.channel_order_id <> ''
      ), matching_events AS (
        SELECT matched.order_id,
          COALESCE(NULLIF(events.event_at, ''), events.received_at) AS ofd_at,
          TO_CHAR(COALESCE(NULLIF(events.event_at, ''), events.received_at)::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS event_date,
          events.status
        FROM event_orders matched JOIN webhook_events events ON events.id = matched.event_id
      ), matching_ofd_events AS (
        SELECT order_id, ofd_at, event_date AS ofd_date
        FROM matching_events
        WHERE UPPER(TRIM(status)) = 'OUT FOR DELIVERY'
      ), deduped_ofd_days AS (
        SELECT order_id, ofd_date, MAX(ofd_at) AS ofd_at
        FROM matching_ofd_events
        GROUP BY order_id, ofd_date
      ), selected_orders AS (
        SELECT orders.id, orders.channel_order_id, orders.customer_name,
          orders.customer_phone, orders.customer_city, orders.customer_state, orders.status,
          orders.payment_method, orders.total, orders.awb, orders.courier,
          orders.shipped_at, orders.first_out_for_delivery_at, orders.out_for_delivery_at, orders.delivered_at,
          orders.ndr_reason, orders.ndr_attempts, orders.ndr_raised_at, orders.shipping_cost, orders.attempt_count,
          COALESCE(
            CASE WHEN ? >= ? THEN selected_event.ofd_at END,
            CASE WHEN ${latestOfdDateSql} = ? THEN out_for_delivery_at END,
            CASE WHEN ${firstOfdDateSql} = ? THEN first_out_for_delivery_at END,
            CASE WHEN ${deliveredDateSql} = ? THEN COALESCE(NULLIF(out_for_delivery_at, ''), first_out_for_delivery_at) END,
            selected_event.ofd_at
          ) AS selected_ofd_at,
          GREATEST(
            COALESCE((SELECT COUNT(DISTINCT previous.ofd_date) FROM deduped_ofd_days previous WHERE previous.order_id = orders.id AND previous.ofd_date <= ?), 0),
            COALESCE((SELECT COUNT(DISTINCT audit.ofd_date) FROM today_ofd_audit audit WHERE audit.order_id = orders.id AND audit.ofd_date <= ?), 0)
          )::integer AS recorded_ofd_days,
          EXISTS(SELECT 1 FROM matching_events failed
            WHERE failed.order_id = orders.id AND failed.event_date < ? AND (${ndrSql})) AS previous_undelivered
        FROM orders
        LEFT JOIN deduped_ofd_days selected_event
          ON selected_event.order_id = orders.id AND selected_event.ofd_date = ?
        WHERE (
          ${latestOfdDateSql} = ?
          OR (COALESCE(out_for_delivery_at, '') = '' AND ${firstOfdDateSql} = ?)
          OR (? >= ? AND selected_event.ofd_at IS NOT NULL)
        )
      )
      SELECT id, channel_order_id AS channelOrderId, customer_name AS customerName,
        customer_phone AS customerPhone,
        customer_city AS customerCity, customer_state AS customerState, selected_orders.status,
        payment_method AS paymentMethod, total, awb, courier,
        shipped_at AS shippedAt, first_out_for_delivery_at AS firstOutForDeliveryAt,
        selected_ofd_at AS outForDeliveryAt, delivered_at AS deliveredAt,
        ndr_reason AS ndrReason, ndr_attempts AS ndrAttempts, ndr_raised_at AS ndrRaisedAt,
        shipping_cost AS shippingCost, attempt_count AS "attemptCount", attempt_count AS attempt_count, attempt_count, recorded_ofd_days AS recordedOfdDays,
        previous_undelivered AS previousUndelivered,
        (SELECT outcome.status FROM matching_events outcome
          WHERE outcome.order_id = selected_orders.id
            AND outcome.ofd_at::timestamptz >= selected_orders.selected_ofd_at::timestamptz
            AND outcome.event_date = ?
          ORDER BY outcome.ofd_at::timestamptz DESC LIMIT 1) AS latestKnownStatus
      FROM selected_orders
      WHERE selected_ofd_at IS NOT NULL AND selected_ofd_at != ''
      ORDER BY selected_ofd_at DESC, id DESC
    `
    )
    .bind(
      selectedDate,
      todayStr,
      selectedDate,
      selectedDate,
      selectedDate,
      selectedDate,
      selectedDate,
      selectedDate,
      selectedDate,
      selectedDate,
      selectedDate,
      selectedDate,
      todayStr,
      selectedDate
    )
    .all<Record<string, unknown>>();

  const orderIds = (res.results || []).map((r) => r.id).filter(Boolean);
  const ledgerMap = new Map<string, { count: number; wasUndelivered: boolean }>();
  if (orderIds.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const slice = orderIds.slice(i, i + CHUNK);
      const ledgerRows = await db
        .prepare(
          `SELECT order_id, COUNT(DISTINCT ofd_date) as cnt,
                  BOOL_OR(final_status IN ('UNDELIVERED', 'UNRESOLVED AFTER OFD')) as was_undel
           FROM ofd_ledger
           WHERE order_id IN (${slice.map(() => "?").join(",")}) AND ofd_date < ?
           GROUP BY order_id`
        )
        .bind(...slice, selectedDate)
        .all<{ order_id: string | number; cnt: number; was_undel: boolean }>()
        .catch(() => ({ results: [] }));
      for (const r of ledgerRows.results || []) {
        ledgerMap.set(String(r.order_id), { count: Number(r.cnt || 0), wasUndelivered: Boolean(r.was_undel) });
      }
    }
  }

  const mapped: OfdOrderRecord[] = (res.results || []).map((row) => {
    const ledgerInfo = ledgerMap.get(String(row.id));
    const priorLedgerCount = ledgerInfo?.count || 0;
    const priorRecordedOfdDays = Math.max(Number(row.recordedOfdDays || 0), priorLedgerCount);
    const wasPriorUndelivered = Boolean(row.previousUndelivered || ledgerInfo?.wasUndelivered);

    const attemptNumber = deriveOrderAttemptNumber(
      {
        id: String(row.id),
        status: String(row.status || ""),
        firstOutForDeliveryAt: String(row.firstOutForDeliveryAt || ""),
        outForDeliveryAt: String(row.outForDeliveryAt || ""),
        deliveredAt: String(row.deliveredAt || ""),
        ndrAttempts: Number(row.ndrAttempts || 0),
        attemptNumber: priorRecordedOfdDays,
        attemptCount: Number(row.attemptCount ?? row.attempt_count ?? row.attemptcount ?? 0),
      },
      selectedDate,
      priorRecordedOfdDays
    );

    return {
      id: row.id as string | number,
      channelOrderId: String(row.channelOrderId || ""),
      customerName: String(row.customerName || ""),
      customerPhone: String(row.customerPhone || ""),
      customerCity: String(row.customerCity || ""),
      customerState: String(row.customerState || ""),
      status: String(row.status || ""),
      paymentMethod: String(row.paymentMethod || ""),
      total: Number(row.total || 0),
      awb: String(row.awb || ""),
      courier: String(row.courier || ""),
      shippedAt: String(row.shippedAt || ""),
      firstOutForDeliveryAt: String(row.firstOutForDeliveryAt || ""),
      outForDeliveryAt: String(row.outForDeliveryAt || ""),
      deliveredAt: String(row.deliveredAt || ""),
      ndrReason: String(row.ndrReason || ""),
      ndrAttempts: Number(row.ndrAttempts || 0),
      ndrRaisedAt: String(row.ndrRaisedAt || ""),
      shippingCost: Number(row.shippingCost || 0),
      recordedOfdDays: priorRecordedOfdDays,
      attemptNumber,
      attemptCount: Number(row.attemptCount ?? row.attempt_count ?? row.attemptcount ?? attemptNumber),
      previousUndelivered: Boolean(wasPriorUndelivered || attemptNumber > 1),
      latestKnownStatus: row.latestKnownStatus ? String(row.latestKnownStatus) : undefined,
    };
  });

  return { results: mapped };
}
