import { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/auth/access";
import { getRuntimeEnv, ensureSchema } from "@/lib/database";
import { deliveredSql, rtoSql, ndrSql, openPopulationSql, highRiskSql, lowRiskSql } from "@/lib/analytics-status";

export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const indiaDateSql = (column: string) =>
  `(CASE WHEN ${column} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN TO_CHAR(${column}::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') ELSE SUBSTR(${column}, 1, 10) END)`;
const orderAnalyticsDateSql = indiaDateSql("COALESCE(NULLIF(order_date, ''), created_at)");

// Number of delivery tries an order needed (1, 2, 3, 4 = "4th or later").
const attemptNumberSql = `(
  CASE
    WHEN attempt_count >= 4 THEN 4
    WHEN attempt_count = 3 THEN 3
    WHEN attempt_count = 2 THEN 2
    WHEN attempt_count = 1 THEN 1
    WHEN UPPER(status) LIKE '%4TH ATTEMPT%' THEN 4
    WHEN UPPER(status) LIKE '%3RD ATTEMPT%' THEN 3
    WHEN UPPER(status) LIKE '%2ND ATTEMPT%' THEN 2
    WHEN UPPER(status) LIKE '%1ST ATTEMPT%' THEN 1
    WHEN ndr_attempts >= 3 THEN 4
    WHEN ndr_attempts = 2 THEN 3
    WHEN ndr_attempts = 1 THEN 2
    ELSE 1
  END
)`;
const reasonSql = "COALESCE(NULLIF(TRIM(ndr_reason), ''), 'Reason not supplied')";
const ndrHistorySql = `(${ndrSql} OR ndr_attempts > 0 OR COALESCE(ndr_reason,'') != '' OR COALESCE(ndr_raised_at,'') != '')`;

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export async function GET(request: NextRequest) {
  try {
    const access = await requireApiUser();
    if (access.response) return access.response;
    const runtime = getRuntimeEnv();
    await ensureSchema(runtime.DB);

    const url = new URL(request.url);
    const type = url.searchParams.get("type") === "rto" ? "rto" : "ndr";

    const filters: string[] = [];
    const values: unknown[] = [];
    let from = url.searchParams.get("from")?.trim();
    let to = url.searchParams.get("to")?.trim();
    if (from && !isoDate.test(from)) from = undefined;
    if (to && !isoDate.test(to)) to = undefined;
    if (from && to && from > to) [from, to] = [to, from];
    if (from) { filters.push(`${orderAnalyticsDateSql} >= ?`); values.push(from); }
    if (to) { filters.push(`${orderAnalyticsDateSql} <= ?`); values.push(to); }
    const payment = url.searchParams.get("payment")?.trim();
    const courier = url.searchParams.get("courier")?.trim();
    const state = url.searchParams.get("state")?.trim();
    const risk = url.searchParams.get("risk")?.trim();
    const product = url.searchParams.get("product")?.trim();
    if (payment) { filters.push("LOWER(payment_method) = LOWER(?)"); values.push(payment); }
    if (courier) { filters.push("LOWER(courier) = LOWER(?)"); values.push(courier); }
    if (state) { filters.push("LOWER(customer_state) = LOWER(?)"); values.push(state); }
    if (risk === "high") filters.push(highRiskSql);
    if (risk === "low") filters.push(lowRiskSql);
    if (product) { filters.push("LOWER(products_json) LIKE LOWER(?)"); values.push(`%${product}%`); }
    const base = filters.length ? filters.join(" AND ") : "1 = 1";
    const scope = type === "rto" ? rtoSql : ndrHistorySql;

    const [reasonRes, funnelRes, ordersRes] = await Promise.all([
      runtime.DB.prepare(`
        SELECT ${reasonSql} AS reason,
          COUNT(*) AS count,
          SUM(CASE WHEN ${attemptNumberSql} = 1 THEN 1 ELSE 0 END) AS a1,
          SUM(CASE WHEN ${attemptNumberSql} = 2 THEN 1 ELSE 0 END) AS a2,
          SUM(CASE WHEN ${attemptNumberSql} >= 3 THEN 1 ELSE 0 END) AS a3,
          SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN ${rtoSql} THEN 1 ELSE 0 END) AS rto
        FROM orders WHERE ${base} AND ${scope}
        GROUP BY 1 ORDER BY count DESC
      `).bind(...values).all<Record<string, unknown>>(),
      runtime.DB.prepare(`
        SELECT ${attemptNumberSql} AS attempt,
          COUNT(*) AS shipped,
          SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN ${rtoSql} THEN 1 ELSE 0 END) AS rto
        FROM orders WHERE ${base} AND ${openPopulationSql}
        GROUP BY 1 ORDER BY 1
      `).bind(...values).all<Record<string, unknown>>(),
      runtime.DB.prepare(`
        SELECT id, channel_order_id, awb, courier, customer_name, customer_city, customer_state,
          payment_method, total, order_date, status, ndr_reason, ndr_attempts, attempt_count,
          ndr_raised_at, delivered_at, ${reasonSql} AS reason, ${attemptNumberSql} AS attempts
        FROM orders WHERE ${base} AND ${scope}
        ORDER BY COALESCE(NULLIF(ndr_raised_at, ''), NULLIF(order_date, ''), created_at) DESC
        LIMIT 400
      `).bind(...values).all<Record<string, unknown>>(),
    ]);

    const totalScope = reasonRes.results.reduce((s, r) => s + Number(r.count || 0), 0);
    const reasons = reasonRes.results.map((r) => ({
      reason: String(r.reason),
      count: Number(r.count),
      percent: pct(Number(r.count), totalScope),
      attempt1: Number(r.a1 || 0),
      attempt2: Number(r.a2 || 0),
      attempt3Plus: Number(r.a3 || 0),
      delivered: Number(r.delivered || 0),
      rto: Number(r.rto || 0),
    }));

    // Cumulative delivery % over every delivery try, across the whole shipped population.
    const byAttempt = new Map(funnelRes.results.map((r) => [Number(r.attempt), r]));
    const shippedTotal = funnelRes.results.reduce((s, r) => s + Number(r.shipped || 0), 0);
    let cumulative = 0;
    let cumulativeRto = 0;
    const attemptFunnel = [1, 2, 3, 4].map((n) => {
      const row = byAttempt.get(n);
      const delivered = Number(row?.delivered || 0);
      const rto = Number(row?.rto || 0);
      cumulative += delivered;
      cumulativeRto += rto;
      return {
        attempt: n,
        label: n === 4 ? "4th+ try" : n === 1 ? "1st try" : n === 2 ? "2nd try" : "3rd try",
        delivered,
        rto,
        incrementalDeliveryPct: pct(delivered, shippedTotal),
        cumulativeDeliveryPct: pct(cumulative, shippedTotal),
        cumulativeRtoPct: pct(cumulativeRto, shippedTotal),
      };
    });

    return Response.json({
      type,
      totalIncidents: totalScope,
      shipped: shippedTotal,
      reasons,
      attemptFunnel,
      orders: ordersRes.results,
    });
  } catch (error) {
    console.error("exceptions analytics failed", error);
    return Response.json({ error: "Failed to load exception analytics" }, { status: 500 });
  }
}
