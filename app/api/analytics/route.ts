import { loadOfdRecords } from "../../../lib/ofd";
import { errorResponse } from "../../../lib/http";
import { requireApiUser } from "../../../lib/auth/access";
import { ensureSchema, getRuntimeEnv } from "../../../lib/database";
import {
  deliveredSql,
  rtoSql,
  ndrSql,
  inTransitSql,
  closedSql,
  openPopulationSql,
  shippedHistorySql,
  nonShippedSql,
  cancelledSql,
  highRiskSql,
  lowRiskSql,
} from "../../../lib/analytics-status";
import { cachedValue } from "../../../lib/server-cache";

export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const indiaDateSql = (column: string) => `SUBSTR(${column}, 1, 10)`;
const orderAnalyticsDateSql = indiaDateSql("COALESCE(NULLIF(order_date, ''), created_at)");

const orderAttemptNumberSql = `(
  CASE
    WHEN ndr_attempts >= 3 THEN 4
    WHEN ndr_attempts = 2 THEN 3
    WHEN LENGTH(first_out_for_delivery_at) >= 10 AND LENGTH(out_for_delivery_at) >= 10 THEN
      CASE
        WHEN SUBSTR(first_out_for_delivery_at, 1, 10) = SUBSTR(out_for_delivery_at, 1, 10) THEN
          CASE
            WHEN ndr_attempts = 1 OR ndr_raised_at != '' OR ndr_reason != '' THEN 2
            ELSE 1
          END
        ELSE
          CASE
            WHEN (SUBSTR(out_for_delivery_at, 1, 10)::date - SUBSTR(first_out_for_delivery_at, 1, 10)::date) = 1 THEN 2
            WHEN (SUBSTR(out_for_delivery_at, 1, 10)::date - SUBSTR(first_out_for_delivery_at, 1, 10)::date) = 2 THEN 3
            ELSE 4
          END
      END
    WHEN ndr_attempts = 1 OR ndr_raised_at != '' OR ndr_reason != '' THEN 2
    ELSE 1
  END
)`;

const DEFAULT_COURIERS = [
  "Delhivery DS 1kg",
  "Shadowfax DS 1kg",
  "Delhivery DS 500gm",
  "Shadowfax DS 500",
  "Delhivery Surface",
  "Shadowfax Surface",
  "DTDC Surface",
  "DTDC Surface 20kg",
  "Blue Dart Surface",
  "Blue Dart Air",
  "Ekart Logistics Surface",
  "India Post-Business Parcel_2.0",
  "OTHER",
];

let filterOptionsCache: { couriers: string[]; states: string[]; expiresAt: number } | null = null;

async function getFilterOptions(db: { prepare: (sql: string) => { all: <T>() => Promise<{ results: T[] }> } }): Promise<{ couriers: string[]; states: string[] }> {
  const now = Date.now();
  if (filterOptionsCache && filterOptionsCache.expiresAt > now) {
    return { couriers: filterOptionsCache.couriers, states: filterOptionsCache.states };
  }
  try {
    const [couriersRes, statesRes] = await Promise.all([
      db.prepare("SELECT DISTINCT courier AS value FROM orders WHERE courier != '' AND courier IS NOT NULL ORDER BY courier").all<{ value: string }>(),
      db.prepare("SELECT DISTINCT customer_state AS value FROM orders WHERE customer_state != '' AND customer_state IS NOT NULL ORDER BY customer_state").all<{ value: string }>(),
    ]);
    const couriers = (couriersRes?.results || []).map((r) => r.value).filter(Boolean);
    const states = (statesRes?.results || []).map((r) => r.value).filter(Boolean);
    filterOptionsCache = {
      couriers: couriers.length ? couriers : DEFAULT_COURIERS,
      states,
      expiresAt: now + 15 * 60 * 1000,
    };
    return { couriers: filterOptionsCache.couriers, states: filterOptionsCache.states };
  } catch {
    if (filterOptionsCache) return { couriers: filterOptionsCache.couriers, states: filterOptionsCache.states };
    return { couriers: DEFAULT_COURIERS, states: [] };
  }
}

function indiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function percent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function metric(count: unknown, total: number) {
  const value = Math.max(0, Number(count || 0));
  return { count: value, percent: percent(value, total) };
}

function statusBucket(statusValue: unknown) {
  const status = String(statusValue || "").trim().toUpperCase();
  if (status === "UNRESOLVED AFTER OFD") return "unresolved" as const;
  if (status === "DELIVERED" || status === "DELIVERED TO CUSTOMER") return "delivered" as const;
  if (status.startsWith("RTO") || status.includes("RETURN TO ORIGIN")) return "rto" as const;
  if (status === "UNDELIVERED" || status === "NDR" || status === "NDR PENDING" || status.startsWith("UNDELIVERED"))
    return "undelivered" as const;
  if (status === "OUT FOR DELIVERY") return "stillOut" as const;
  return "other" as const;
}

function isOpenDeliveryStatus(statusValue: unknown) {
  const status = String(statusValue || "").trim().toUpperCase();
  return [
    "SHIPPED",
    "IN TRANSIT",
    "IN TRANSIT-EN-ROUTE",
    "IN TRANSIT-AT DESTINATION HUB",
    "REACHED AT DESTINATION HUB",
    "PICKED UP",
    "MISROUTED",
    "UNTRACEABLE",
    "OUT FOR DELIVERY",
  ].includes(status);
}

function indiaDateFromValue(value: unknown) {
  const source = String(value || "");
  if (!source) return "";
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return source.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

export async function GET(request: Request) {
  try {
    return await handleGET(request);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleGET(request: Request) {
  const access = await requireApiUser();
  if (access.response) return access.response;

  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "today_ofd" ? "today_ofd" : "overview";

  if (mode === "today_ofd") {
    const currentIndiaDate = indiaToday();
    const requestedDate = url.searchParams.get("date") || currentIndiaDate;
    const selectedDate =
      isoDate.test(requestedDate) && requestedDate <= currentIndiaDate ? requestedDate : currentIndiaDate;

    const payload = await cachedValue(`analytics-today-ofd-${selectedDate}`, 60000, async () => {
      const history = await runtime.DB.prepare(
        "SELECT key,value FROM sync_state WHERE key IN ('tracking_history_status','tracking_history_last_sync_at')"
      ).all<{ key: string; value: string }>();
      const historyState = Object.fromEntries(history.results.map((r) => [r.key, r.value]));
      const trackingHistory = {
        status: historyState.tracking_history_status || "pending",
        lastSyncAt: historyState.tracking_history_last_sync_at || "",
        cached: true,
      };
      const rows = await loadOfdRecords(runtime.DB, selectedDate);
      const orders: Array<Record<string, unknown> & { attemptNumber: number; previousUndelivered: boolean }> =
        rows.results.map((row) => {
          let status = String(row.latestKnownStatus || "");
          if ((!status || isOpenDeliveryStatus(status)) && indiaDateFromValue(row.deliveredAt) === selectedDate)
            status = "DELIVERED";
          if (!status && indiaDateFromValue(row.ndrRaisedAt) === selectedDate) status = "UNDELIVERED";
          if (!status) status = selectedDate === currentIndiaDate ? String(row.status || "") : "UNRESOLVED AFTER OFD";
          if (selectedDate < currentIndiaDate && isOpenDeliveryStatus(status)) status = "UNRESOLVED AFTER OFD";
          let attemptNumber = Number(row.attemptNumber || 0);
          if (!attemptNumber) {
            const firstOfdDate = indiaDateFromValue(row.firstOutForDeliveryAt);
            const latestOfdDate = indiaDateFromValue(row.outForDeliveryAt);
            if (firstOfdDate && firstOfdDate === selectedDate) {
              attemptNumber = 1;
            } else if (latestOfdDate && latestOfdDate === selectedDate && firstOfdDate && firstOfdDate !== selectedDate) {
              const ndrAtt = Number(row.ndrAttempts || 0);
              attemptNumber = Math.max(2, ndrAtt + (statusBucket(status) === "undelivered" ? 0 : 1));
            } else {
              attemptNumber = 1;
            }
          }
          return {
            ...row,
            status,
            latestKnownStatus: undefined,
            attemptNumber: Math.max(1, attemptNumber),
            attemptBasis: "recorded_ofd_days",
            previousUndelivered: Boolean(row.previousUndelivered || attemptNumber > 1),
          };
        });
      const total = orders.length;
      const bucketCounts = { delivered: 0, undelivered: 0, stillOut: 0, unresolved: 0, rto: 0, other: 0 };
      const attemptCounts = { first: 0, second: 0, third: 0, later: 0, unknown: 0 };
      for (const order of orders) {
        const bucket = statusBucket(order.status);
        bucketCounts[bucket] += 1;
        const attempt = Number(order.attemptNumber);
        if (!attempt) attemptCounts.unknown += 1;
        else if (attempt === 1) attemptCounts.first += 1;
        else if (attempt === 2) attemptCounts.second += 1;
        else if (attempt === 3) attemptCounts.third += 1;
        else attemptCounts.later += 1;
      }
      const previousUndelivered = orders.filter((order) => order.previousUndelivered).length;
      return {
        date: selectedDate,
        metrics: {
          total: metric(total, total),
          delivered: metric(bucketCounts.delivered, total),
          undelivered: metric(bucketCounts.undelivered, total),
          stillOut: metric(bucketCounts.stillOut, total),
          unresolved: metric(bucketCounts.unresolved, total),
          firstAttemptOFD: metric(attemptCounts.first, total),
          secondAttemptOFD: metric(attemptCounts.second, total),
          unknownAttemptOFD: metric(attemptCounts.unknown, total),
          thirdAttemptOFD: metric(attemptCounts.third, total),
          laterAttemptOFD: metric(attemptCounts.later, total),
          previousUndelivered: metric(previousUndelivered, total),
          rto: metric(bucketCounts.rto, total),
          other: metric(bucketCounts.other, total),
        },
        attemptBasis: "Recorded OFD days; courier attempt ordinals are not verified",
        trackingHistory,
        orders,
      };
    });

    return Response.json(payload);
  }

  const filters: string[] = [];
  const filterValues: unknown[] = [];

  let from = url.searchParams.get("from")?.trim();
  let to = url.searchParams.get("to")?.trim();
  if (from && !isoDate.test(from)) from = undefined;
  if (to && !isoDate.test(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];

  const payment = url.searchParams.get("payment")?.trim();
  const courier = url.searchParams.get("courier")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const risk = url.searchParams.get("risk")?.trim();

  if (from) {
    filters.push(`${orderAnalyticsDateSql} >= ?`);
    filterValues.push(from);
  }
  if (to) {
    filters.push(`${orderAnalyticsDateSql} <= ?`);
    filterValues.push(to);
  }
  if (payment) {
    filters.push("LOWER(payment_method) = LOWER(?)");
    filterValues.push(payment);
  }
  if (courier) {
    filters.push("LOWER(courier) = LOWER(?)");
    filterValues.push(courier);
  }
  if (state) {
    filters.push("LOWER(customer_state) = LOWER(?)");
    filterValues.push(state);
  }
  if (risk === "high") filters.push(highRiskSql);
  if (risk === "low") filters.push(lowRiskSql);

  const where = filters.length ? filters.join(" AND ") : "1 = 1";
  const cacheKey = `analytics-overview-${where}-${filterValues.join(":")}`;

  const payload = await cachedValue(cacheKey, 120000, async () => {
    const ndrReasonSql = "COALESCE(NULLIF(ndr_reason, ''), 'Reason not supplied')";
    const whereO = where
      .replaceAll("customer_state", "o.customer_state")
      .replaceAll("payment_method", "o.payment_method")
      .replaceAll("courier", "o.courier")
      .replaceAll("order_date", "o.order_date")
      .replaceAll("created_at", "o.created_at")
      .replaceAll("status", "o.status");

    // Execute all analytical queries concurrently for maximum performance
    const [
      summary,
      ndrReasons,
      courierRows,
      stateRows,
      dateRows,
      productRows,
      statuses,
      syncRows,
      filterOptions,
    ] = await Promise.all([
      // 1. Core Summary Metrics
      runtime.DB.prepare(`
        SELECT 
          COUNT(*) AS total,
          SUM(CASE WHEN LOWER(payment_method) = 'prepaid' THEN 1 ELSE 0 END) AS prepaid,
          SUM(CASE WHEN LOWER(payment_method) = 'cod' THEN 1 ELSE 0 END) AS cod,
          SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN ${rtoSql} THEN 1 ELSE 0 END) AS rto,
          SUM(CASE WHEN ${ndrSql} THEN 1 ELSE 0 END) AS ndr,
          SUM(CASE WHEN ${inTransitSql} AND UPPER(TRIM(status)) != 'OUT FOR DELIVERY' THEN 1 ELSE 0 END) AS in_transit,
          SUM(CASE WHEN ${inTransitSql} AND UPPER(TRIM(status)) != 'OUT FOR DELIVERY' AND (${orderAttemptNumberSql} = 1 OR first_out_for_delivery_at = '') AND (ndr_attempts = 0 OR ndr_attempts IS NULL) AND ndr_raised_at = '' THEN 1 ELSE 0 END) AS in_transit_zero_attempts,
          SUM(CASE WHEN ${inTransitSql} AND UPPER(TRIM(status)) != 'OUT FOR DELIVERY' AND NOT ((${orderAttemptNumberSql} = 1 OR first_out_for_delivery_at = '') AND (ndr_attempts = 0 OR ndr_attempts IS NULL) AND ndr_raised_at = '') THEN 1 ELSE 0 END) AS in_transit_with_attempts,
          SUM(CASE WHEN UPPER(TRIM(status)) = 'OUT FOR DELIVERY' THEN 1 ELSE 0 END) AS out_for_delivery,
          SUM(CASE WHEN ${nonShippedSql} THEN 1 ELSE 0 END) AS non_shipped,
          SUM(CASE WHEN ${cancelledSql} THEN 1 ELSE 0 END) AS cancelled,
          SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS closed,
          SUM(CASE WHEN ${openPopulationSql} THEN 1 ELSE 0 END) AS shipped,
          SUM(CASE WHEN ${shippedHistorySql} THEN 1 ELSE 0 END) AS shipped_history,
          SUM(CASE WHEN ${highRiskSql} THEN 1 ELSE 0 END) AS high_risk,
          SUM(CASE WHEN ${lowRiskSql} THEN 1 ELSE 0 END) AS low_risk,
          SUM(CASE WHEN ${deliveredSql} AND (${orderAttemptNumberSql} = 1) THEN 1 ELSE 0 END) AS del_1st_attempt,
          SUM(CASE WHEN ${deliveredSql} AND (${orderAttemptNumberSql} = 2) THEN 1 ELSE 0 END) AS del_2nd_attempt,
          SUM(CASE WHEN ${deliveredSql} AND (${orderAttemptNumberSql} = 3) THEN 1 ELSE 0 END) AS del_3rd_attempt,
          SUM(CASE WHEN ${deliveredSql} AND (${orderAttemptNumberSql} >= 4) THEN 1 ELSE 0 END) AS del_later_attempt,
          SUM(CASE WHEN LOWER(payment_method) = 'cod' AND ${openPopulationSql} THEN 1 ELSE 0 END) AS cod_shipped,
          SUM(CASE WHEN LOWER(payment_method) = 'cod' AND ${deliveredSql} THEN 1 ELSE 0 END) AS cod_delivered,
          SUM(CASE WHEN LOWER(payment_method) = 'cod' AND ${closedSql} THEN 1 ELSE 0 END) AS cod_closed,
          SUM(CASE WHEN LOWER(payment_method) = 'prepaid' AND ${openPopulationSql} THEN 1 ELSE 0 END) AS prepaid_shipped,
          SUM(CASE WHEN LOWER(payment_method) = 'prepaid' AND ${deliveredSql} THEN 1 ELSE 0 END) AS prepaid_delivered,
          SUM(CASE WHEN LOWER(payment_method) = 'prepaid' AND ${closedSql} THEN 1 ELSE 0 END) AS prepaid_closed,
          SUM(CASE WHEN (${ndrSql} OR ndr_attempts > 0 OR (ndr_reason != '' AND ndr_reason IS NOT NULL) OR (ndr_raised_at != '' AND ndr_raised_at IS NOT NULL)) THEN 1 ELSE 0 END) AS total_ndr_experienced,
          SUM(CASE WHEN ${deliveredSql} AND (ndr_attempts > 0 OR (ndr_reason != '' AND ndr_reason IS NOT NULL) OR (ndr_raised_at != '' AND ndr_raised_at IS NOT NULL) OR ${orderAttemptNumberSql} > 1) THEN 1 ELSE 0 END) AS ndr_delivered,
          AVG(CASE WHEN ${deliveredSql} AND LENGTH(delivered_at) >= 10 AND LENGTH(shipped_at) >= 10 THEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 END) AS avg_shipped_to_delivered_days,
          AVG(CASE WHEN ${deliveredSql} AND LENGTH(delivered_at) >= 10 AND LENGTH(COALESCE(NULLIF(order_date, ''), created_at)) >= 10 THEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - COALESCE(NULLIF(order_date, ''), created_at)::timestamptz)) / 86400 END) AS avg_order_to_delivered_days,
          COALESCE(SUM(CASE WHEN ${deliveredSql} THEN total ELSE 0 END), 0) AS "deliveredRevenue",
          COALESCE(SUM(CASE WHEN ${deliveredSql} THEN total ELSE 0 END), 0) AS delivered_revenue,
          AVG(CASE WHEN ${deliveredSql} AND shipping_cost > 0 THEN shipping_cost END) AS "avgShippingCost",
          AVG(CASE WHEN ${deliveredSql} AND shipping_cost > 0 THEN shipping_cost END) AS avg_shipping_cost,
          COUNT(*) FILTER (WHERE ${deliveredSql} AND shipping_cost > 0) AS "deliveredShippingCostCount",
          COUNT(*) FILTER (WHERE ${deliveredSql} AND shipping_cost > 0) AS delivered_shipping_cost_count,
          AVG(CASE WHEN ${deliveredSql} THEN total END) AS "avgDeliveredOrderValue",
          AVG(CASE WHEN ${deliveredSql} THEN total END) AS avg_delivered_order_value
        FROM orders WHERE ${where}
      `).bind(...filterValues).first<Record<string, unknown>>(),

      // 2. NDR Reasons
      runtime.DB.prepare(`
        SELECT ${ndrReasonSql} AS reason, COUNT(*) AS count
        FROM orders
        WHERE ${where} AND (${ndrSql} OR ndr_attempts > 0 OR (ndr_reason != '' AND ndr_reason IS NOT NULL))
        GROUP BY reason
        ORDER BY count DESC
        LIMIT 12
      `).bind(...filterValues).all<{ reason: string; count: number }>(),

      // 3. Courier-wise Delivery
      runtime.DB.prepare(`
        SELECT 
          COALESCE(NULLIF(courier, ''), 'Not assigned') AS name,
          COUNT(*) AS total,
          SUM(CASE WHEN ${openPopulationSql} THEN 1 ELSE 0 END) AS shipped,
          SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN ${rtoSql} THEN 1 ELSE 0 END) AS rto,
          SUM(CASE WHEN ${ndrSql} THEN 1 ELSE 0 END) AS ndr,
          SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS closed,
          AVG(CASE WHEN ${deliveredSql} AND LENGTH(delivered_at) >= 10 AND LENGTH(shipped_at) >= 10 THEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 END) AS avg_tat
        FROM orders WHERE ${where}
        GROUP BY name
        ORDER BY total DESC
        LIMIT 15
      `).bind(...filterValues).all<{
        name: string;
        total: number;
        shipped: number;
        delivered: number;
        rto: number;
        ndr: number;
        closed: number;
        avg_tat: number | null;
      }>(),

      // 4. State-wise Delivery
      runtime.DB.prepare(`
        SELECT 
          COALESCE(NULLIF(customer_state, ''), 'Unknown state') AS state,
          COUNT(*) AS total,
          SUM(CASE WHEN ${openPopulationSql} THEN 1 ELSE 0 END) AS shipped,
          SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN ${rtoSql} THEN 1 ELSE 0 END) AS rto,
          SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS closed
        FROM orders WHERE ${where}
        GROUP BY state
        ORDER BY total DESC
        LIMIT 25
      `).bind(...filterValues).all<{
        state: string;
        total: number;
        shipped: number;
        delivered: number;
        rto: number;
        closed: number;
      }>(),

      // 5. Date-wise Delivery
      runtime.DB.prepare(`
        SELECT 
          ${orderAnalyticsDateSql} AS dt,
          COUNT(*) AS total,
          SUM(CASE WHEN ${openPopulationSql} THEN 1 ELSE 0 END) AS shipped,
          SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN ${rtoSql} THEN 1 ELSE 0 END) AS rto,
          SUM(CASE WHEN ${ndrSql} THEN 1 ELSE 0 END) AS ndr,
          SUM(CASE WHEN ${inTransitSql} AND UPPER(TRIM(status)) != 'OUT FOR DELIVERY' THEN 1 ELSE 0 END) AS in_transit,
          SUM(CASE WHEN UPPER(TRIM(status)) = 'OUT FOR DELIVERY' THEN 1 ELSE 0 END) AS out_for_delivery
        FROM orders WHERE ${where}
        GROUP BY dt
        ORDER BY dt DESC
        LIMIT 31
      `).bind(...filterValues).all<{
        dt: string;
        total: number;
        shipped: number;
        delivered: number;
        rto: number;
        ndr: number;
        in_transit: number;
        out_for_delivery: number;
      }>(),

      // 6. Product-wise Delivery
      runtime.DB.prepare(`
        SELECT 
          elem->>'name' AS name,
          COUNT(DISTINCT o.id) AS order_count,
          COUNT(DISTINCT o.id) FILTER (WHERE ${deliveredSql.replaceAll("status", "o.status")}) AS delivered,
          COUNT(DISTINCT o.id) FILTER (WHERE ${rtoSql.replaceAll("status", "o.status")}) AS rto,
          COUNT(DISTINCT o.id) FILTER (WHERE ${openPopulationSql.replaceAll("status", "o.status")}) AS shipped
        FROM (
          SELECT id, status, products_json
          FROM orders o
          WHERE ${whereO}
          ORDER BY COALESCE(NULLIF(order_date, ''), created_at) DESC
          LIMIT 5000
        ) o,
        jsonb_array_elements(CASE WHEN o.products_json LIKE '[%' THEN o.products_json::jsonb ELSE '[]'::jsonb END) elem
        WHERE elem->>'name' IS NOT NULL AND elem->>'name' != ''
        GROUP BY name
        ORDER BY order_count DESC
        LIMIT 20
      `).bind(...filterValues).all<{
        name: string;
        order_count: number;
        delivered: number;
        rto: number;
        shipped: number;
      }>(),

      // 7. Status breakdown
      runtime.DB.prepare(`
        SELECT UPPER(TRIM(status)) AS status, COUNT(*) AS count, ${closedSql} AS attempted, ${openPopulationSql} AS shipped
        FROM orders WHERE ${where}
        GROUP BY UPPER(TRIM(status))
        ORDER BY COUNT(*) DESC
      `).bind(...filterValues).all<{ status: string; count: number; attempted: boolean; shipped: boolean }>(),

      // 8. Sync state
      runtime.DB.prepare("SELECT key, value FROM sync_state WHERE key IN ('sync_status', 'last_sync_at', 'last_sync_count', 'last_sync_error')").all<{ key: string; value: string }>(),

      // 9. Cached filter options
      getFilterOptions(runtime.DB)
    ]);

    const total = Number(summary?.total || 0);
    const shipped = Number(summary?.shipped || 0);
    const delivered = Number(summary?.delivered || 0);
    const closed = Number(summary?.closed || 0);
    const rto = Number(summary?.rto || 0);
    const ndr = Number(summary?.ndr || 0);
    const inTransit = Number(summary?.in_transit || 0);
    const inTransitZeroAttempts = Number(summary?.in_transit_zero_attempts || 0);
    const inTransitWithAttempts = Number(summary?.in_transit_with_attempts || 0);
    const outForDelivery = Number(summary?.out_for_delivery || 0);
    const nonShipped = Number(summary?.non_shipped || 0);
    const cancelled = Number(summary?.cancelled || 0);

    const del1stAttempt = Number(summary?.del_1st_attempt || 0);
    const del2ndAttempt = Number(summary?.del_2nd_attempt || 0);
    const del3rdAttempt = Number(summary?.del_3rd_attempt || 0);
    const delLaterAttempt = Number(summary?.del_later_attempt || 0);

    const cod = Number(summary?.cod || 0);
    const prepaid = Number(summary?.prepaid || 0);
    const codShipped = Number(summary?.cod_shipped || 0);
    const codDelivered = Number(summary?.cod_delivered || 0);
    const codClosed = Number(summary?.cod_closed || 0);
    const prepaidShipped = Number(summary?.prepaid_shipped || 0);
    const prepaidDelivered = Number(summary?.prepaid_delivered || 0);
    const prepaidClosed = Number(summary?.prepaid_closed || 0);

    const totalNdrExperienced = Number(summary?.total_ndr_experienced || 0);
    const ndrDelivered = Number(summary?.ndr_delivered || 0);

    const avgShippedTatDays =
      summary?.avg_shipped_to_delivered_days != null ? Number(summary.avg_shipped_to_delivered_days) : null;
    const avgOrderTatDays =
      summary?.avg_order_to_delivered_days != null ? Number(summary.avg_order_to_delivered_days) : null;

    const syncState = Object.fromEntries(syncRows.results.map((r) => [r.key, r.value || ""]));

  return {
    statusBreakdown: statuses.results,
    metrics: {
      // 1. Overall Delivery %
      total: metric(total, total),
      delivered: metric(delivered, total),
      deliveryRate: percent(delivered, total),

      // 2. Open orders delivery % = delivered / all shipped (date range)
      shipped: metric(shipped, total),
      openPopulation: metric(shipped, total),
      openDeliveryRate: percent(delivered, shipped),
      openOrdersDeliveryRate: percent(delivered, shipped),
      shippedDeliveryRate: percent(delivered, shipped),

      // 3. Closed orders delivery % = delivered / (undelivered + rto + delivered)
      closed: metric(closed, total),
      closedOrdersDeliveryRate: percent(delivered, closed),

      // 4. RTO % = rto / shipped
      rto: metric(rto, shipped),
      closedRto: metric(rto, closed),
      rtoRate: percent(rto, shipped),
      rtoOfTotal: metric(rto, total),

      // 5. In transit %
      inTransit: metric(inTransit, shipped),
      inTransitZeroAttempts: metric(inTransitZeroAttempts, inTransit > 0 ? inTransit : 1),
      inTransitWithAttempts: metric(inTransitWithAttempts, inTransit > 0 ? inTransit : 1),

      // 6. Out for delivery %
      outForDelivery: metric(outForDelivery, shipped),

      // 7. Attempt breakdown
      firstAttemptDelivered: metric(del1stAttempt, delivered > 0 ? delivered : 1),
      secondAttemptDelivered: metric(del2ndAttempt, delivered > 0 ? delivered : 1),
      thirdAttemptDelivered: metric(del3rdAttempt, delivered > 0 ? delivered : 1),
      laterAttemptDelivered: metric(delLaterAttempt, delivered > 0 ? delivered : 1),

      // 8. Payment ratios and delivery %
      cod: metric(cod, total),
      prepaid: metric(prepaid, total),
      codRatio: percent(cod, total),
      prepaidRatio: percent(prepaid, total),
      codDeliveryRate: percent(codDelivered, codShipped),
      prepaidDeliveryRate: percent(prepaidDelivered, prepaidShipped),
      codClosedDeliveryRate: percent(codDelivered, codClosed),
      prepaidClosedDeliveryRate: percent(prepaidDelivered, prepaidClosed),
      codShipped: Number(codShipped),
      codDelivered: Number(codDelivered),
      prepaidShipped: Number(prepaidShipped),
      prepaidDelivered: Number(prepaidDelivered),

      // 9. NDR / Undelivered delivery %
      ndr: metric(ndr, total),
      closedNdr: metric(ndr, closed),
      totalNdrExperienced: metric(totalNdrExperienced, shipped > 0 ? shipped : 1),
      ndrDelivered: metric(ndrDelivered, totalNdrExperienced > 0 ? totalNdrExperienced : 1),
      ndrDeliveryRate: percent(ndrDelivered, totalNdrExperienced),

      // 10. Avg time to deliver (TAT)
      avgShippedTatDays: avgShippedTatDays != null ? Math.round(avgShippedTatDays * 10) / 10 : null,
      avgOrderTatDays: avgOrderTatDays != null ? Math.round(avgOrderTatDays * 10) / 10 : null,

      nonShipped: metric(nonShipped, total),
      cancelled: metric(cancelled, total),
    },
    financials: {
      deliveredRevenue: Number(summary?.deliveredRevenue || summary?.delivered_revenue || 0),
      avgShippingCost: Number(summary?.avgShippingCost || summary?.avg_shipping_cost || 0),
      deliveredShippingCostCount: Number(summary?.deliveredShippingCostCount || summary?.delivered_shipping_cost_count || 0),
      avgDeliveredOrderValue: Number(summary?.avgDeliveredOrderValue || summary?.avg_delivered_order_value || 0),
      deliveredCount: delivered,
    },
    byCourier: courierRows.results.map((row) => ({
      name: row.name,
      total: Number(row.total),
      delivered: Number(row.delivered),
      outcomes: Number(row.closed),
      rate: percent(Number(row.delivered), Number(row.closed)),
    })),
    byState: stateRows.results.map((row) => ({
      name: row.state,
      total: Number(row.total),
      delivered: Number(row.delivered),
      outcomes: Number(row.closed),
      rate: percent(Number(row.delivered), Number(row.closed)),
    })),
    ndrReasons: ndrReasons.results.map((r) => ({
      reason: r.reason,
      count: Number(r.count),
      percent: percent(Number(r.count), totalNdrExperienced),
    })),
    courierWise: courierRows.results.map((r) => ({
      name: r.name,
      total: Number(r.total),
      shipped: Number(r.shipped),
      delivered: Number(r.delivered),
      rto: Number(r.rto),
      ndr: Number(r.ndr),
      closed: Number(r.closed),
      deliveryRate: percent(Number(r.delivered), Number(r.shipped)),
      closedDeliveryRate: percent(Number(r.delivered), Number(r.closed)),
      rtoRate: percent(Number(r.rto), Number(r.shipped)),
      avgTatDays: r.avg_tat != null ? Math.round(Number(r.avg_tat) * 10) / 10 : null,
    })),
    stateWise: stateRows.results.map((r) => ({
      state: r.state,
      total: Number(r.total),
      shipped: Number(r.shipped),
      delivered: Number(r.delivered),
      rto: Number(r.rto),
      closed: Number(r.closed),
      deliveryRate: percent(Number(r.delivered), Number(r.shipped)),
      closedDeliveryRate: percent(Number(r.delivered), Number(r.closed)),
      rtoRate: percent(Number(r.rto), Number(r.shipped)),
    })),
    dateWise: dateRows.results.map((r) => ({
      date: r.dt,
      total: Number(r.total),
      shipped: Number(r.shipped),
      delivered: Number(r.delivered),
      rto: Number(r.rto),
      ndr: Number(r.ndr),
      inTransit: Number(r.in_transit),
      outForDelivery: Number(r.out_for_delivery),
      deliveryRate: percent(Number(r.delivered), Number(r.shipped)),
      rtoRate: percent(Number(r.rto), Number(r.shipped)),
    })),
    productWise: productRows.results.map((r) => ({
      name: r.name,
      orderCount: Number(r.order_count),
      shipped: Number(r.shipped),
      delivered: Number(r.delivered),
      rto: Number(r.rto),
      deliveryRate: percent(Number(r.delivered), Number(r.shipped)),
      closedDeliveryRate: percent(Number(r.delivered), Number(r.delivered) + Number(r.rto)),
    })),
    filterOptions: {
      couriers: filterOptions.couriers,
      states: filterOptions.states,
    },
    dataQuality: {
      source: "Shiprocket synced orders",
      dateBasis: "Order date in Asia/Kolkata",
      orderCount: total,
      lastSyncAt: syncState.last_sync_at || "",
      syncStatus: syncState.sync_status || "unknown",
      lastSyncCount: Number(syncState.last_sync_count || 0),
      lastSyncError: syncState.last_sync_error || "",
    },
    syncState,
    };
  });

  return Response.json(payload);
}
