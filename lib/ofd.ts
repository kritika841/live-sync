import type { PostgresDatabase } from "./database";
const ndrSql = "(UPPER(TRIM(status)) IN ('UNDELIVERED', 'NDR', 'NDR PENDING') OR UPPER(TRIM(status)) LIKE 'UNDELIVERED%')";
const indiaDateSql = (column: string) => `(CASE WHEN ${column} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN TO_CHAR(${column}::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') ELSE SUBSTR(${column}, 1, 10) END)`;
const latestOfdDateSql=indiaDateSql("out_for_delivery_at");
const firstOfdDateSql=indiaDateSql("first_out_for_delivery_at");
export async function loadOfdRecords(db:PostgresDatabase,selectedDate:string){
  return db.prepare(`
      WITH matching_events AS (
        SELECT orders.id AS order_id,
          COALESCE(NULLIF(events.event_at, ''), events.received_at) AS ofd_at,
          TO_CHAR(COALESCE(NULLIF(events.event_at, ''), events.received_at)::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS event_date,
          events.status
        FROM orders
        JOIN webhook_events events ON
          (events.shiprocket_order_id IS NOT NULL AND events.shiprocket_order_id = orders.id)
          OR (events.shipment_id IS NOT NULL AND events.shipment_id = orders.shipment_id)
          OR (events.awb IS NOT NULL AND events.awb != '' AND events.awb = orders.awb)
          OR (events.channel_order_id IS NOT NULL AND events.channel_order_id = orders.channel_order_id)
      ), matching_ofd_events AS (
        SELECT order_id, ofd_at, event_date AS ofd_date
        FROM matching_events
        WHERE UPPER(TRIM(status)) = 'OUT FOR DELIVERY'
      ), deduped_ofd_days AS (
        SELECT order_id, ofd_date, MAX(ofd_at) AS ofd_at
        FROM matching_ofd_events
        GROUP BY order_id, ofd_date
      ), selected_orders AS (
        SELECT orders.*,
          COALESCE(
            selected_event.ofd_at,
            CASE WHEN ${latestOfdDateSql} = ? THEN out_for_delivery_at END,
            CASE WHEN ${firstOfdDateSql} = ? THEN first_out_for_delivery_at END
          ) AS selected_ofd_at,
          NULLIF((SELECT COUNT(*) FROM deduped_ofd_days previous
            WHERE previous.order_id = orders.id AND previous.ofd_date <= ?),0)::integer AS attempt_number,
          EXISTS(SELECT 1 FROM matching_events failed
            WHERE failed.order_id=orders.id AND failed.event_date < ? AND (${ndrSql})) AS previous_undelivered
        FROM orders
        LEFT JOIN deduped_ofd_days selected_event
          ON selected_event.order_id = orders.id AND selected_event.ofd_date = ?
      )
      SELECT id, channel_order_id AS channelOrderId, customer_name AS customerName,
        customer_city AS customerCity, customer_state AS customerState, selected_orders.status,
        payment_method AS paymentMethod, total, awb, courier,
        shipped_at AS shippedAt, first_out_for_delivery_at AS firstOutForDeliveryAt,
        selected_ofd_at AS outForDeliveryAt, delivered_at AS deliveredAt,
        ndr_reason AS ndrReason, ndr_attempts AS ndrAttempts, ndr_raised_at AS ndrRaisedAt,
        shipping_cost AS shippingCost, attempt_number AS attemptNumber,
        previous_undelivered AS previousUndelivered,
        (SELECT outcome.status FROM matching_events outcome
          WHERE outcome.order_id = selected_orders.id
            AND outcome.ofd_at::timestamptz >= selected_orders.selected_ofd_at::timestamptz
            AND outcome.event_date = ?
          ORDER BY outcome.ofd_at::timestamptz DESC LIMIT 1) AS latestKnownStatus
      FROM selected_orders
      WHERE selected_ofd_at IS NOT NULL AND selected_ofd_at != ''
      ORDER BY selected_ofd_at DESC, id DESC
    `).bind(selectedDate, selectedDate, selectedDate, selectedDate, selectedDate, selectedDate).all<Record<string, unknown>>();
}
