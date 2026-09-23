import {getRuntimeEnv} from "./database";
import {deliveredSql,rtoSql,ndrSql,cancelledSql,nonShippedSql,inTransitSql,highRiskSql,lowRiskSql,shopifyHighRiskSql,shiprocketHighRiskSql,closedSql,openPopulationSql,shippedHistorySql} from "./analytics-status";
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const indiaDateSql = (column: string) => `(CASE WHEN ${column} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN TO_CHAR(${column}::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') ELSE SUBSTR(${column}, 1, 10) END)`;
const orderAnalyticsDateSql = indiaDateSql("COALESCE(NULLIF(order_date, ''), created_at)");

function percent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

export function metric(count: unknown, total: number) {
  const value = Math.max(0, Number(count || 0));
  return { count: value, percent: percent(value, total) };
}

export async function analyticsOverview(runtime: ReturnType<typeof getRuntimeEnv>, url: URL) {
  const filters: string[] = ["channel_id = ?"];
  const values: unknown[] = [Number(runtime.SHIPROCKET_CHANNEL_ID || 9574697)];
  let from = url.searchParams.get("from")?.trim();
  let to = url.searchParams.get("to")?.trim();
  if (from && !isoDate.test(from)) from = undefined;
  if (to && !isoDate.test(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  const payment = url.searchParams.get("payment")?.trim();
  const courier = url.searchParams.get("courier")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const risk = url.searchParams.get("risk")?.trim();
  if (from) { filters.push(`${orderAnalyticsDateSql} >= ?`); values.push(from); }
  if (to) { filters.push(`${orderAnalyticsDateSql} <= ?`); values.push(to); }
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
      SUM(CASE WHEN ${inTransitSql} THEN 1 ELSE 0 END) AS "inTransit",
      SUM(CASE WHEN ${nonShippedSql} THEN 1 ELSE 0 END) AS "nonShipped",
      SUM(CASE WHEN ${cancelledSql} THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS closed,
      SUM(CASE WHEN ${openPopulationSql} THEN 1 ELSE 0 END) AS "openPopulation",
      SUM(CASE WHEN ${shippedHistorySql} THEN 1 ELSE 0 END) AS shipped,
      SUM(CASE WHEN ${highRiskSql} THEN 1 ELSE 0 END) AS "highRisk",
      SUM(CASE WHEN ${lowRiskSql} THEN 1 ELSE 0 END) AS "lowRisk",
      SUM(CASE WHEN ${shopifyHighRiskSql} THEN 1 ELSE 0 END) AS "shopifyHighRisk",
      SUM(CASE WHEN ${shiprocketHighRiskSql} THEN 1 ELSE 0 END) AS "shiprocketHighRisk",
      SUM(CASE WHEN ${shopifyHighRiskSql} AND ${shiprocketHighRiskSql} THEN 1 ELSE 0 END) AS "bothHighRisk",
      SUM(CASE WHEN NOT (${highRiskSql}) AND NOT (${lowRiskSql}) THEN 1 ELSE 0 END) AS "unknownRisk",
      COALESCE(SUM(CASE WHEN ${deliveredSql} THEN total ELSE 0 END), 0) AS "deliveredRevenue",
      AVG(CASE WHEN ${deliveredSql} AND shipping_cost > 0 THEN shipping_cost END) AS "avgShippingCost",
      COUNT(*) FILTER (WHERE ${deliveredSql} AND shipping_cost > 0) AS "deliveredShippingCostCount",
      AVG(CASE WHEN ${deliveredSql} THEN total END) AS "avgDeliveredOrderValue"
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
      SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS outcomes,
      SUM(CASE WHEN ${openPopulationSql} THEN 1 ELSE 0 END) AS "shippedOutcomes"
    FROM orders WHERE ${where} GROUP BY name ORDER BY total DESC LIMIT 12
  `).bind(...values).all<{ name: string; total: number; delivered: number; outcomes: number; shippedOutcomes: number }>();
  const stateRows = await runtime.DB.prepare(`
    SELECT COALESCE(NULLIF(INITCAP(LOWER(TRIM(customer_state))), ''), 'Unknown state') AS name, COUNT(*) AS total,
      SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN ${closedSql} THEN 1 ELSE 0 END) AS outcomes,
      SUM(CASE WHEN ${openPopulationSql} THEN 1 ELSE 0 END) AS "shippedOutcomes"
    FROM orders WHERE ${where} GROUP BY name ORDER BY total DESC LIMIT 12
  `).bind(...values).all<{ name: string; total: number; delivered: number; outcomes: number; shippedOutcomes: number }>();
  const ndrReasonSql = "COALESCE(NULLIF(INITCAP(LOWER(TRIM(ndr_reason))), ''), 'Reason not supplied')";
  const ndrReasons = await runtime.DB.prepare(`
    SELECT ${ndrReasonSql} AS reason, COUNT(*) AS count
    FROM orders WHERE ${where} AND (${ndrSql} OR ndr_reason<>'' OR ndr_attempts>0 OR ndr_raised_at<>'')
    GROUP BY reason ORDER BY count DESC,reason
  `).bind(...values).all<{ reason: string; count: number }>();
  const options = await runtime.DB.batch([
    runtime.DB.prepare("SELECT DISTINCT courier AS value FROM orders WHERE courier != '' ORDER BY courier"),
    runtime.DB.prepare("SELECT DISTINCT INITCAP(LOWER(TRIM(customer_state))) AS value FROM orders WHERE customer_state != '' ORDER BY value"),
    runtime.DB.prepare("SELECT key, value FROM sync_state WHERE key IN ('sync_status', 'last_sync_at', 'last_sync_count', 'last_sync_error', 'fast_sync_last_at', 'fast_sync_error', 'historical_reconciliation_at')"),
    runtime.DB.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${highRiskSql} THEN 1 ELSE 0 END) AS "highRisk",
      SUM(CASE WHEN ${lowRiskSql} THEN 1 ELSE 0 END) AS "lowRisk",
      SUM(CASE WHEN NOT (${highRiskSql}) AND NOT (${lowRiskSql}) THEN 1 ELSE 0 END) AS "unknownRisk",
      SUM(CASE WHEN ${shopifyHighRiskSql} THEN 1 ELSE 0 END) AS "shopifyHighRisk",
      SUM(CASE WHEN ${shiprocketHighRiskSql} THEN 1 ELSE 0 END) AS "shiprocketHighRisk",
      SUM(CASE WHEN ${shopifyHighRiskSql} AND ${shiprocketHighRiskSql} THEN 1 ELSE 0 END) AS "bothHighRisk",
      SUM(CASE WHEN ${ndrSql} OR ndr_reason<>'' OR ndr_attempts>0 OR ndr_raised_at<>'' THEN 1 ELSE 0 END) AS "ndrHistory"
      FROM orders WHERE channel_id=?`).bind(Number(runtime.SHIPROCKET_CHANNEL_ID || 9574697)),
  ]);
  const syncState = Object.fromEntries(options[2].results.map((row) => [String(row.key), String(row.value || "")]));

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
      deliveredCount: Number(summary?.delivered || 0),
      shippingCostCount: Number(summary?.deliveredShippingCostCount || 0),
    },
    risk: {
      high: metric(summary?.highRisk, taggedRisk), low: metric(summary?.lowRisk, taggedRisk),
      unknown: metric(summary?.unknownRisk, total),
      sources: {
        shopifyHigh: Number(summary?.shopifyHighRisk || 0),
        shiprocketHigh: Number(summary?.shiprocketHighRisk || 0),
        bothHigh: Number(summary?.bothHighRisk || 0),
      },
    },
    byCourier: courierRows.results.map((row) => ({ ...row, rate: percent(Number(row.delivered || 0), Number(row.outcomes || 0)) })),
    byState: stateRows.results.map((row) => ({ ...row, rate: percent(Number(row.delivered || 0), Number(row.outcomes || 0)) })),
    ndrReasons: ndrReasons.results,
    allHistory: (() => {
      const row = options[3].results[0] || {};
      const historyTotal = Number(row.total || 0);
      const historyRiskTotal = Number(row.highRisk || 0) + Number(row.lowRisk || 0);
      return {
        orders: historyTotal,
        highRisk: metric(row.highRisk, historyRiskTotal),
        lowRisk: metric(row.lowRisk, historyRiskTotal),
        unknownRisk: metric(row.unknownRisk, historyTotal),
        shopifyHigh: Number(row.shopifyHighRisk || 0),
        shiprocketHigh: Number(row.shiprocketHighRisk || 0),
        bothHigh: Number(row.bothHighRisk || 0),
        ndrHistory: Number(row.ndrHistory || 0),
      };
    })(),
    filterOptions: {
      couriers: options[0].results.map((row) => String(row.value)),
      states: options[1].results.map((row) => String(row.value)),
    },
    dataQuality: {
      source: "Shiprocket synced orders",
      dateBasis: "Order date in Asia/Kolkata",
      orderCount: total,
      lastSyncAt: [syncState.last_sync_at,syncState.fast_sync_last_at,syncState.historical_reconciliation_at].filter(Boolean).sort().at(-1) || "",
      syncStatus: syncState.sync_status || "unknown",
      lastSyncCount: Number(syncState.last_sync_count || 0),
      lastSyncError: syncState.last_sync_error || "",
    },
  });
}
