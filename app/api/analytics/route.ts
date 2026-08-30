import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureSchema, getRuntimeEnv } from "../../../lib/database";

export const dynamic = "force-dynamic";

const deliveredSql = "UPPER(TRIM(status)) IN ('DELIVERED', 'DELIVERED TO CUSTOMER')";
const rtoSql = "(UPPER(TRIM(status)) LIKE 'RTO%' OR UPPER(TRIM(status)) LIKE '%RETURN TO ORIGIN%')";
const ndrSql = "(UPPER(TRIM(status)) IN ('UNDELIVERED', 'NDR', 'NDR PENDING') OR UPPER(TRIM(status)) LIKE 'UNDELIVERED%')";
const cancelledSql = "UPPER(TRIM(status)) IN ('CANCELED', 'CANCELLED', 'ORDER CANCELED', 'ORDER CANCELLED')";
const nonShippedSql = `UPPER(TRIM(status)) IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING', 'READY TO SHIP', 'AWB ASSIGNED', 'PICKUP SCHEDULED', 'MANIFEST GENERATED', 'OUT FOR PICKUP', 'PICKUP EXCEPTION')`;
const highRiskSql = "LOWER(REPLACE(REPLACE(COALESCE(json_extract(raw_json, '$.rto_risk'), ''), '_', ' '), '-', ' ')) IN ('high', 'very high')";
const terminalSql = `(${deliveredSql} OR ${rtoSql} OR ${ndrSql})`;

async function isAllowed() {
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(await getChatGPTUser());
}

function indiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function percent(count: number, total: number) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function metric(count: unknown, total: number) {
  const value = Number(count || 0);
  return { count: value, percent: percent(value, total) };
}

export async function GET(request: Request) {
  if (!(await isAllowed())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "today_ofd" ? "today_ofd" : "overview";

  if (mode === "today_ofd") {
    const today = url.searchParams.get("date") || indiaToday();
    const rows = await runtime.DB.prepare(`
      SELECT id, channel_order_id AS channelOrderId, customer_name AS customerName,
        customer_city AS customerCity, customer_state AS customerState, status,
        payment_method AS paymentMethod, total, awb, courier,
        out_for_delivery_at AS outForDeliveryAt, delivered_at AS deliveredAt,
        EXISTS(
          SELECT 1 FROM webhook_events events
          WHERE UPPER(TRIM(events.status)) LIKE 'UNDELIVERED%'
            AND events.received_at < orders.out_for_delivery_at
            AND ((events.shiprocket_order_id IS NOT NULL AND events.shiprocket_order_id = orders.id)
              OR (events.shipment_id IS NOT NULL AND events.shipment_id = orders.shipment_id)
              OR (events.awb IS NOT NULL AND events.awb != '' AND events.awb = orders.awb)
              OR (events.channel_order_id IS NOT NULL AND events.channel_order_id = orders.channel_order_id))
        ) AS previousUndelivered
      FROM orders
      WHERE SUBSTR(out_for_delivery_at, 1, 10) = ?
      ORDER BY out_for_delivery_at DESC, id DESC
    `).bind(today).all<Record<string, unknown>>();
    const orders = rows.results.map((row) => ({ ...row, previousUndelivered: Boolean(row.previousUndelivered) }));
    const total = orders.length;
    const delivered = orders.filter((order) => /^(DELIVERED|DELIVERED TO CUSTOMER)$/i.test(String(order.status))).length;
    const undelivered = orders.filter((order) => /^(UNDELIVERED|NDR|NDR PENDING)/i.test(String(order.status))).length;
    const stillOut = orders.filter((order) => /^OUT FOR DELIVERY$/i.test(String(order.status))).length;
    const previousUndelivered = orders.filter((order) => order.previousUndelivered).length;
    return Response.json({
      date: today,
      metrics: {
        total: metric(total, total), delivered: metric(delivered, total), undelivered: metric(undelivered, total),
        stillOut: metric(stillOut, total), previousUndelivered: metric(previousUndelivered, total),
        other: metric(Math.max(0, total - delivered - undelivered - stillOut), total),
      },
      orders,
    });
  }

  const filters: string[] = [];
  const values: unknown[] = [];
  let from = url.searchParams.get("from")?.trim();
  let to = url.searchParams.get("to")?.trim();
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
  if (risk === "low") filters.push(`NOT (${highRiskSql})`);
  const where = filters.length ? filters.join(" AND ") : "1 = 1";
  const shippingCostSql = `CAST(COALESCE(
    NULLIF(json_extract(raw_json, '$.shipping_charges'), ''),
    NULLIF(json_extract(raw_json, '$.freight_charges'), ''),
    NULLIF(json_extract(raw_json, '$.shipments.freight_charges'), ''),
    NULLIF(json_extract(raw_json, '$.shipments[0].freight_charges'), ''), 0
  ) AS REAL)`;

  const summary = await runtime.DB.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN LOWER(payment_method) = 'prepaid' THEN 1 ELSE 0 END) AS prepaid,
      SUM(CASE WHEN LOWER(payment_method) = 'cod' THEN 1 ELSE 0 END) AS cod,
      SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN ${rtoSql} THEN 1 ELSE 0 END) AS rto,
      SUM(CASE WHEN ${ndrSql} THEN 1 ELSE 0 END) AS ndr,
      SUM(CASE WHEN ${nonShippedSql} THEN 1 ELSE 0 END) AS nonShipped,
      SUM(CASE WHEN ${cancelledSql} THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN ${terminalSql} THEN 1 ELSE 0 END) AS terminal,
      SUM(CASE WHEN ${highRiskSql} THEN 1 ELSE 0 END) AS highRisk,
      SUM(CASE WHEN ${highRiskSql} THEN 0 ELSE 1 END) AS lowRisk,
      SUM(CASE WHEN ${deliveredSql} THEN total ELSE 0 END) AS deliveredRevenue,
      AVG(CASE WHEN ${shippingCostSql} > 0 THEN ${shippingCostSql} END) AS avgShippingCost,
      AVG(CASE WHEN ${deliveredSql} THEN total END) AS avgDeliveredOrderValue
    FROM orders WHERE ${where}
  `).bind(...values).first<Record<string, unknown>>();
  const total = Number(summary?.total || 0);
  const terminal = Number(summary?.terminal || 0);

  const courierRows = await runtime.DB.prepare(`
    SELECT COALESCE(NULLIF(courier, ''), 'Not assigned') AS name, COUNT(*) AS total,
      SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN ${terminalSql} THEN 1 ELSE 0 END) AS outcomes
    FROM orders WHERE ${where} GROUP BY name ORDER BY total DESC LIMIT 12
  `).bind(...values).all<{ name: string; total: number; delivered: number; outcomes: number }>();
  const stateRows = await runtime.DB.prepare(`
    SELECT COALESCE(NULLIF(customer_state, ''), 'Unknown state') AS name, COUNT(*) AS total,
      SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN ${terminalSql} THEN 1 ELSE 0 END) AS outcomes
    FROM orders WHERE ${where} GROUP BY name ORDER BY total DESC LIMIT 12
  `).bind(...values).all<{ name: string; total: number; delivered: number; outcomes: number }>();
  const ndrReasonSql = `COALESCE(
    NULLIF(json_extract(raw_json, '$.ndr_reason'), ''),
    NULLIF(json_extract(raw_json, '$.ndr_reason_description'), ''),
    NULLIF(json_extract(raw_json, '$.shipments.ndr_reason'), ''),
    NULLIF(json_extract(raw_json, '$.shipments[0].ndr_reason'), ''),
    'Reason not supplied'
  )`;
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
      delivered: metric(summary?.delivered, total), deliveryRate: metric(summary?.delivered, terminal),
      rto: metric(summary?.rto, total), ndr: metric(summary?.ndr, total),
      nonShipped: metric(summary?.nonShipped, total), cancelled: metric(summary?.cancelled, total),
    },
    financials: {
      deliveredRevenue: Number(summary?.deliveredRevenue || 0),
      avgShippingCost: Number(summary?.avgShippingCost || 0),
      avgDeliveredOrderValue: Number(summary?.avgDeliveredOrderValue || 0),
    },
    risk: {
      high: metric(summary?.highRisk, total), low: metric(summary?.lowRisk, total),
    },
    byCourier: courierRows.results.map((row) => ({ ...row, rate: percent(Number(row.delivered || 0), Number(row.outcomes || 0)) })),
    byState: stateRows.results.map((row) => ({ ...row, rate: percent(Number(row.delivered || 0), Number(row.outcomes || 0)) })),
    ndrReasons: ndrReasons.results,
    filterOptions: {
      couriers: ((options[0] as D1Result<{ value: string }>).results || []).map((row) => row.value),
      states: ((options[1] as D1Result<{ value: string }>).results || []).map((row) => row.value),
    },
  });
}
