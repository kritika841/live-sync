import { requireApiUser } from "../../../lib/auth/access";
import { ensureSchema, getRuntimeEnv } from "../../../lib/database";

export const dynamic = "force-dynamic";

const deliveredSql = "UPPER(TRIM(status)) IN ('DELIVERED', 'DELIVERED TO CUSTOMER')";
const rtoSql = "(UPPER(TRIM(status)) LIKE 'RTO%' OR UPPER(TRIM(status)) LIKE '%RETURN TO ORIGIN%')";
const ndrSql = "(UPPER(TRIM(status)) IN ('UNDELIVERED', 'NDR', 'NDR PENDING') OR UPPER(TRIM(status)) LIKE 'UNDELIVERED%')";
const cancelledSql = "UPPER(TRIM(status)) IN ('CANCELED', 'CANCELLED', 'ORDER CANCELED', 'ORDER CANCELLED')";
const nonShippedSql = `UPPER(TRIM(status)) IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING', 'READY TO SHIP', 'AWB ASSIGNED', 'PICKUP SCHEDULED', 'MANIFEST GENERATED', 'OUT FOR PICKUP', 'PICKUP EXCEPTION')`;
const inTransitSql = `UPPER(TRIM(status)) IN ('SHIPPED', 'IN TRANSIT', 'IN TRANSIT-EN-ROUTE', 'IN TRANSIT-AT DESTINATION HUB', 'REACHED AT DESTINATION HUB', 'PICKED UP', 'MISROUTED', 'UNTRACEABLE', 'OUT FOR DELIVERY')`;
const riskValueSql = "LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk', ''), '_', ' '), '-', ' '))";
const highRiskSql = `${riskValueSql} IN ('high', 'very high')`;
const lowRiskSql = `${riskValueSql} = 'low'`;
const closedSql = `(${deliveredSql} OR ${rtoSql} OR ${ndrSql})`;
const openPopulationSql = `(${deliveredSql} OR ${inTransitSql})`;
const shippedHistorySql = `(shipped_at != '' OR ${closedSql} OR ${inTransitSql})`;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const indiaDateSql = (column: string) => `(CASE WHEN ${column} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN TO_CHAR(${column}::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') ELSE SUBSTR(${column}, 1, 10) END)`;
const latestOfdDateSql = indiaDateSql("out_for_delivery_at");
const firstOfdDateSql = indiaDateSql("first_out_for_delivery_at");

function indiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function percent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function metric(count: unknown, total: number) {
  const value = Math.max(0, Number(count || 0));
  return { count: value, percent: percent(value, total) };
}

function statusBucket(statusValue: unknown) {
  const status = String(statusValue || "").trim().toUpperCase();
  if (status === "DELIVERED" || status === "DELIVERED TO CUSTOMER") return "delivered" as const;
  if (status.startsWith("RTO") || status.includes("RETURN TO ORIGIN")) return "rto" as const;
  if (status === "UNDELIVERED" || status === "NDR" || status === "NDR PENDING" || status.startsWith("UNDELIVERED")) return "undelivered" as const;
  if (status === "OUT FOR DELIVERY") return "stillOut" as const;
  return "other" as const;
}

export async function GET(request: Request) {
  const access = await requireApiUser();
  if (access.response) return access.response;
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "today_ofd" ? "today_ofd" : "overview";

  if (mode === "today_ofd") {
    const currentIndiaDate = indiaToday();
    const requestedDate = url.searchParams.get("date") || currentIndiaDate;
    const selectedDate = isoDate.test(requestedDate) && requestedDate <= currentIndiaDate ? requestedDate : currentIndiaDate;
    const rows = await runtime.DB.prepare(`
      WITH matching_ofd_events AS (
        SELECT orders.id AS order_id,
          COALESCE(NULLIF(events.event_at, ''), events.received_at) AS ofd_at,
          TO_CHAR(COALESCE(NULLIF(events.event_at, ''), events.received_at)::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS ofd_date
        FROM orders
        JOIN webhook_events events ON
          (events.shiprocket_order_id IS NOT NULL AND events.shiprocket_order_id = orders.id)
          OR (events.shipment_id IS NOT NULL AND events.shipment_id = orders.shipment_id)
          OR (events.awb IS NOT NULL AND events.awb != '' AND events.awb = orders.awb)
          OR (events.channel_order_id IS NOT NULL AND events.channel_order_id = orders.channel_order_id)
        WHERE UPPER(TRIM(events.status)) = 'OUT FOR DELIVERY'
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
          COALESCE(
            NULLIF((SELECT COUNT(*) FROM deduped_ofd_days previous
              WHERE previous.order_id = orders.id AND previous.ofd_date <= ?), 0),
            CASE
              WHEN ${firstOfdDateSql} = ? THEN 1
              WHEN ${latestOfdDateSql} = ? THEN GREATEST(2,
                ndr_attempts + CASE WHEN ${ndrSql} THEN 0 ELSE 1 END)
              ELSE 1
            END
          )::integer AS attempt_number
        FROM orders
        LEFT JOIN deduped_ofd_days selected_event
          ON selected_event.order_id = orders.id AND selected_event.ofd_date = ?
      )
      SELECT id, channel_order_id AS channelOrderId, customer_name AS customerName,
        customer_city AS customerCity, customer_state AS customerState, status,
        payment_method AS paymentMethod, total, awb, courier,
        shipped_at AS shippedAt, first_out_for_delivery_at AS firstOutForDeliveryAt,
        selected_ofd_at AS outForDeliveryAt, delivered_at AS deliveredAt,
        ndr_reason AS ndrReason, ndr_attempts AS ndrAttempts, ndr_raised_at AS ndrRaisedAt,
        shipping_cost AS shippingCost, attempt_number AS attemptNumber,
        (attempt_number > 1) AS previousUndelivered
      FROM selected_orders
      WHERE selected_ofd_at IS NOT NULL AND selected_ofd_at != ''
      ORDER BY selected_ofd_at DESC, id DESC
    `).bind(selectedDate, selectedDate, selectedDate, selectedDate, selectedDate, selectedDate).all<Record<string, unknown>>();
    const orders: Array<Record<string, unknown> & { attemptNumber: number; previousUndelivered: boolean }> = rows.results.map((row) => ({
      ...row,
      attemptNumber: Math.max(1, Number(row.attemptNumber || 1)),
      previousUndelivered: Boolean(row.previousUndelivered),
    }));
    const total = orders.length;
    const bucketCounts = { delivered: 0, undelivered: 0, stillOut: 0, rto: 0, other: 0 };
    const stillOutAttempts = { first: 0, second: 0, third: 0, later: 0 };
    for (const order of orders) {
      const bucket = statusBucket(order.status);
      bucketCounts[bucket] += 1;
      if (bucket === "stillOut") {
        const attempt = Number(order.attemptNumber);
        if (attempt === 1) stillOutAttempts.first += 1;
        else if (attempt === 2) stillOutAttempts.second += 1;
        else if (attempt === 3) stillOutAttempts.third += 1;
        else stillOutAttempts.later += 1;
      }
    }
    const previousUndelivered = orders.filter((order) => order.previousUndelivered).length;
    return Response.json({
      date: selectedDate,
      metrics: {
        total: metric(total, total), delivered: metric(bucketCounts.delivered, total),
        undelivered: metric(bucketCounts.undelivered, total), stillOut: metric(bucketCounts.stillOut, total),
        firstAttemptOFD: metric(stillOutAttempts.first, total), secondAttemptOFD: metric(stillOutAttempts.second, total),
        thirdAttemptOFD: metric(stillOutAttempts.third, total), laterAttemptOFD: metric(stillOutAttempts.later, total),
        previousUndelivered: metric(previousUndelivered, total), rto: metric(bucketCounts.rto, total),
        other: metric(bucketCounts.other, total),
      },
      orders,
    });
  }

  const filters: string[] = [];
  const values: unknown[] = [];
  let from = url.searchParams.get("from")?.trim();
  let to = url.searchParams.get("to")?.trim();
  if (from && !isoDate.test(from)) from = undefined;
  if (to && !isoDate.test(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  const payment = url.searchParams.get("payment")?.trim();
  const courier = url.searchParams.get("courier")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const risk = url.searchParams.get("risk")?.trim();
  if (from) { filters.push("SUBSTR(COALESCE(NULLIF(order_date, ''), created_at), 1, 10) >= ?"); values.push(from); }
  if (to) { filters.push("SUBSTR(COALESCE(NULLIF(order_date, ''), created_at), 1, 10) <= ?"); values.push(to); }
  if (payment) { filters.push("LOWER(payment_method) = LOWER(?)"); values.push(payment); }
  if (courier) { filters.push("LOWER(courier) = LOWER(?)"); values.push(courier); }
  if (state) { filters.push("LOWER(customer_state) = LOWER(?)"); values.push(state); }
  if (risk === "high") filters.push(highRiskSql);
  if (risk === "low") filters.push(lowRiskSql);
  const where = filters.length ? filters.join(" AND ") : "1 = 1";
  const summary = await runtime.DB.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN LOWER(payment_method) = 'prepaid' THEN 1 ELSE 0 END) AS prepaid,
      SUM(CASE WHEN LOWER(payment_method) = 'cod' THEN 1 ELSE 0 END) AS cod,
      SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN ${rtoSql} THEN 1 ELSE 0 END) AS rto,
      SUM(CASE WHEN ${ndrSql} THEN 1 ELSE 0 END) AS ndr,
      SUM(CASE WHEN ${inTransitSql} THEN 1 ELSE 0 END) AS inTransit,
      SUM(CASE WHEN ${nonShippedSql} THEN 1 ELSE 0 END) AS nonShipped,
      SUM(CASE WHEN ${cancelledSql} THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS closed,
      SUM(CASE WHEN ${openPopulationSql} THEN 1 ELSE 0 END) AS openPopulation,
      SUM(CASE WHEN ${shippedHistorySql} THEN 1 ELSE 0 END) AS shipped,
      SUM(CASE WHEN ${highRiskSql} THEN 1 ELSE 0 END) AS highRisk,
      SUM(CASE WHEN ${lowRiskSql} THEN 1 ELSE 0 END) AS lowRisk,
      SUM(CASE WHEN NOT (${highRiskSql}) AND NOT (${lowRiskSql}) THEN 1 ELSE 0 END) AS unknownRisk,
      SUM(CASE WHEN ${deliveredSql} THEN total ELSE 0 END) AS deliveredRevenue,
      AVG(CASE WHEN shipping_cost > 0 AND ${shippedHistorySql} THEN shipping_cost END) AS avgShippingCost,
      AVG(CASE WHEN ${deliveredSql} THEN total END) AS avgDeliveredOrderValue
    FROM orders WHERE ${where}
  `).bind(...values).first<Record<string, unknown>>();
  const total = Number(summary?.total || 0);
  const closed = Number(summary?.closed || 0);
  const openPopulation = Number(summary?.openPopulation || 0);
  const shipped = Number(summary?.shipped || 0);
  const taggedRisk = Number(summary?.highRisk || 0) + Number(summary?.lowRisk || 0);

  const courierRows = await runtime.DB.prepare(`
    SELECT COALESCE(NULLIF(courier, ''), 'Not assigned') AS name, COUNT(*) AS total,
      SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS outcomes
    FROM orders WHERE ${where} GROUP BY name ORDER BY total DESC LIMIT 12
  `).bind(...values).all<{ name: string; total: number; delivered: number; outcomes: number }>();
  const stateRows = await runtime.DB.prepare(`
    SELECT COALESCE(NULLIF(customer_state, ''), 'Unknown state') AS name, COUNT(*) AS total,
      SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS outcomes
    FROM orders WHERE ${where} GROUP BY name ORDER BY total DESC LIMIT 12
  `).bind(...values).all<{ name: string; total: number; delivered: number; outcomes: number }>();
  const ndrReasonSql = "COALESCE(NULLIF(ndr_reason, ''), 'Reason not supplied')";
  const ndrReasons = await runtime.DB.prepare(`
    SELECT ${ndrReasonSql} AS reason, COUNT(*) AS count
    FROM orders WHERE ${where} AND ${ndrSql}
    GROUP BY reason ORDER BY count DESC LIMIT 10
  `).bind(...values).all<{ reason: string; count: number }>();
  const options = await runtime.DB.batch([
    runtime.DB.prepare("SELECT DISTINCT courier AS value FROM orders WHERE courier != '' ORDER BY courier"),
    runtime.DB.prepare("SELECT DISTINCT customer_state AS value FROM orders WHERE customer_state != '' ORDER BY customer_state"),
  ]);

  return Response.json({
    metrics: {
      total: metric(total, total), prepaid: metric(summary?.prepaid, total), cod: metric(summary?.cod, total),
      delivered: metric(summary?.delivered, total), deliveryRate: metric(summary?.delivered, closed),
      shipped: metric(summary?.shipped, total), shippedDeliveryRate: metric(summary?.delivered, shipped),
      openPopulation: metric(openPopulation, total), openDeliveryRate: metric(summary?.delivered, openPopulation),
      inTransit: metric(summary?.inTransit, openPopulation), closed: metric(closed, total),
      closedRto: metric(summary?.rto, closed), closedNdr: metric(summary?.ndr, closed),
      rto: metric(summary?.rto, total), ndr: metric(summary?.ndr, total),
      nonShipped: metric(summary?.nonShipped, total), cancelled: metric(summary?.cancelled, total),
    },
    financials: {
      deliveredRevenue: Number(summary?.deliveredRevenue || 0),
      avgShippingCost: Number(summary?.avgShippingCost || 0),
      avgDeliveredOrderValue: Number(summary?.avgDeliveredOrderValue || 0),
    },
    risk: {
      high: metric(summary?.highRisk, taggedRisk), low: metric(summary?.lowRisk, taggedRisk),
      unknown: metric(summary?.unknownRisk, total),
    },
    byCourier: courierRows.results.map((row) => ({ ...row, rate: percent(Number(row.delivered || 0), Number(row.outcomes || 0)) })),
    byState: stateRows.results.map((row) => ({ ...row, rate: percent(Number(row.delivered || 0), Number(row.outcomes || 0)) })),
    ndrReasons: ndrReasons.results,
    filterOptions: {
      couriers: options[0].results.map((row) => String(row.value)),
      states: options[1].results.map((row) => String(row.value)),
    },
  });
}
