import type { PostgresDatabase } from "./database";
import { normalizeShiprocketDate } from "./shiprocket";

export interface WebhookOrderIdentifier {
  shiprocketOrderId?: number | null;
  channelOrderId?: string | null;
  shipmentId?: number | null;
  awb?: string | null;
}

/**
 * Extracts explicit attempt count from payload fields or status text.
 * E.g. "UNDELIVERED-1st Attempt" => 1, "UNDELIVERED-2nd Attempt" => 2, etc.
 */
export function extractExplicitAttempt(
  status: string,
  payload?: Record<string, unknown> | null
): number {
  if (payload) {
    const rawAttempts =
      payload.attempt_count ??
      payload.attempts ??
      payload.delivery_attempts ??
      payload.delivery_attempt ??
      payload.ndr_attempts ??
      payload.ndr_attempt;
    const num = Number(rawAttempts);
    if (Number.isFinite(num) && num > 0) return Math.min(5, Math.floor(num));
  }

  const s = String(status || "").toUpperCase();
  const m1 = s.match(/(\d+)(?:ST|ND|RD|TH)?\s*(?:ATTEMPT|OFD)/i);
  if (m1) {
    const n = parseInt(m1[1], 10);
    if (n >= 1 && n <= 5) return n;
  }

  if (s.includes("1ST ATTEMPT") || s.includes("FIRST ATTEMPT")) return 1;
  if (s.includes("2ND ATTEMPT") || s.includes("SECOND ATTEMPT")) return 2;
  if (s.includes("3RD ATTEMPT") || s.includes("THIRD ATTEMPT")) return 3;
  if (s.includes("4TH ATTEMPT") || s.includes("FOURTH ATTEMPT")) return 4;
  if (s.includes("5TH ATTEMPT") || s.includes("FIFTH ATTEMPT")) return 5;

  return 0;
}

/**
 * Automatically computes and updates order attempt_count, OFD timestamps, and statuses
 * directly from incoming webhook events in real-time.
 */
export async function processWebhookAttempt(
  db: PostgresDatabase,
  id: WebhookOrderIdentifier,
  status: string,
  eventAt: string,
  payload?: Record<string, unknown> | null
): Promise<{ orderId?: number | string; attemptCount: number; isNewAttempt: boolean }> {
  const normEventAt = normalizeShiprocketDate(eventAt) || new Date().toISOString();
  const eventDate = normEventAt.slice(0, 10);
  const explicitAttempt = extractExplicitAttempt(status, payload);

  // 1. Fetch current order state
  const whereClauses: string[] = [];
  const params: unknown[] = [];
  if (id.shiprocketOrderId) {
    whereClauses.push("id = ?");
    params.push(id.shiprocketOrderId);
  }
  if (id.channelOrderId) {
    whereClauses.push("channel_order_id = ?");
    params.push(id.channelOrderId);
  }
  if (id.shipmentId) {
    whereClauses.push("shipment_id = ?");
    params.push(id.shipmentId);
  }
  if (id.awb) {
    whereClauses.push("awb = ?");
    params.push(id.awb);
  }

  if (!whereClauses.length) {
    return { attemptCount: explicitAttempt || 1, isNewAttempt: false };
  }

  const order = await db
    .prepare(
      `SELECT id, channel_order_id, first_out_for_delivery_at, out_for_delivery_at, attempt_count, ndr_attempts, status
       FROM orders
       WHERE ${whereClauses.join(" OR ")}
       LIMIT 1`
    )
    .bind(...params)
    .first<{
      id: number;
      channel_order_id: string;
      first_out_for_delivery_at: string;
      out_for_delivery_at: string;
      attempt_count: number | null;
      ndr_attempts: number | null;
      status: string;
    }>();

  if (!order) {
    return { attemptCount: explicitAttempt || 1, isNewAttempt: false };
  }

  const currentAttempt = Number(order.attempt_count || 1);
  const firstOfd = String(order.first_out_for_delivery_at || "").slice(0, 10);
  const isOfd = /OUT FOR DELIVERY/i.test(status);
  const isNdr = /UNDELIVERED|NDR/i.test(status);
  let computedAttempt = currentAttempt;
  let isNewAttempt = false;

  if (isOfd) {
    if (!firstOfd) {
      // Very first OFD scan
      computedAttempt = explicitAttempt > 0 ? explicitAttempt : 1;
      isNewAttempt = true;
    } else if (firstOfd === eventDate) {
      // Re-scan or initial scan on same day
      computedAttempt = explicitAttempt > 0 ? explicitAttempt : currentAttempt;
    } else if (eventDate > firstOfd) {
      // Re-attempt on a subsequent calendar day!
      // Count distinct prior dates from webhook events
      const priorDaysResult = await db
        .prepare(
          `SELECT COUNT(DISTINCT (COALESCE(NULLIF(event_at, ''), received_at)::timestamptz AT TIME ZONE 'Asia/Kolkata')::date) AS prior_days
           FROM webhook_events
           WHERE (shiprocket_order_id = ? OR shipment_id = ? OR awb = ? OR channel_order_id = ?)
             AND (UPPER(TRIM(status)) = 'OUT FOR DELIVERY' OR UPPER(TRIM(status)) LIKE 'UNDELIVERED%' OR UPPER(TRIM(status)) LIKE 'NDR%')
             AND (COALESCE(NULLIF(event_at, ''), received_at)::timestamptz AT TIME ZONE 'Asia/Kolkata')::date < (?::timestamptz AT TIME ZONE 'Asia/Kolkata')::date`
        )
        .bind(
          order.id,
          id.shipmentId || 0,
          id.awb || "",
          order.channel_order_id || "",
          normEventAt
        )
        .first<{ prior_days: string | number }>()
        .catch(() => ({ prior_days: 0 }));

      const priorDays = Math.max(1, Number(priorDaysResult?.prior_days || 0));
      computedAttempt = Math.max(currentAttempt, priorDays + 1, explicitAttempt);
      isNewAttempt = true;
    }
  } else if (isNdr) {
    if (explicitAttempt > 0) {
      computedAttempt = Math.max(currentAttempt, explicitAttempt);
    }
  }

  // Update order with new attempt_count and relevant timestamps
  const finalAttempt = Math.min(5, Math.max(1, computedAttempt));

  let updateSql = `UPDATE orders SET synced_at = NOW(), attempt_count = GREATEST(COALESCE(attempt_count, 1), ?)`;
  const updateBinds: unknown[] = [finalAttempt];

  if (isOfd) {
    updateSql += `,
      out_for_delivery_at = CASE
        WHEN out_for_delivery_at = '' OR out_for_delivery_at !~ '^\\d{4}-\\d{2}-\\d{2}T' OR ?::timestamptz > out_for_delivery_at::timestamptz THEN ?
        ELSE out_for_delivery_at
      END,
      first_out_for_delivery_at = CASE
        WHEN first_out_for_delivery_at = '' OR first_out_for_delivery_at !~ '^\\d{4}-\\d{2}-\\d{2}T' OR ?::timestamptz < first_out_for_delivery_at::timestamptz THEN ?
        ELSE first_out_for_delivery_at
      END`;
    updateBinds.push(normEventAt, normEventAt, normEventAt, normEventAt);
  }

  if (isNdr) {
    const ndrReason = String(payload?.reason || payload?.ndr_reason || payload?.activity || "");
    updateSql += `,
      ndr_attempts = GREATEST(COALESCE(ndr_attempts, 0), ?),
      ndr_reason = CASE WHEN ? != '' THEN ? ELSE ndr_reason END,
      ndr_raised_at = ?`;
    updateBinds.push(finalAttempt, ndrReason, ndrReason, normEventAt);
  }

  updateSql += ` WHERE id = ?`;
  updateBinds.push(order.id);

  await db.prepare(updateSql).bind(...updateBinds).run();

  return {
    orderId: order.id,
    attemptCount: finalAttempt,
    isNewAttempt,
  };
}
