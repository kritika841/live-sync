import { NextRequest } from "next/server";
import { getRuntimeEnv, ensureSchema } from "@/lib/database";
import {
  deliveredSql,
  rtoSql,
  ndrSql,
  openPopulationSql,
  highRiskSql,
  lowRiskSql,
} from "@/lib/analytics-status";

export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const indiaDateSql = (column: string) =>
  `(CASE WHEN ${column} ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN TO_CHAR(${column}::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') ELSE SUBSTR(${column}, 1, 10) END)`;
const orderAnalyticsDateSql = indiaDateSql("COALESCE(NULLIF(order_date, ''), created_at)");

const orderAttemptNumberSql = `(
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
    WHEN first_out_for_delivery_at != '' AND out_for_delivery_at != '' AND ${indiaDateSql("first_out_for_delivery_at")} != ${indiaDateSql("out_for_delivery_at")} THEN 2
    ELSE 1
  END
)`;

const ndrAttemptNumberSql = `(
  CASE
    WHEN ndr_attempts >= 3 THEN 3
    WHEN ndr_attempts = 2 THEN 2
    WHEN ndr_attempts = 1 THEN 1
    WHEN attempt_count >= 3 THEN 3
    WHEN attempt_count = 2 THEN 2
    WHEN attempt_count = 1 THEN 1
    WHEN UPPER(status) LIKE '%3RD ATTEMPT%' OR UPPER(status) LIKE '%4TH ATTEMPT%' THEN 3
    WHEN UPPER(status) LIKE '%2ND ATTEMPT%' THEN 2
    ELSE 1
  END
)`;

const ndrReasonSql = "COALESCE(NULLIF(ndr_reason, ''), 'Reason not supplied')";

function round(n: number, decimals = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

export async function GET(request: NextRequest) {
  try {
    const runtime = await getRuntimeEnv();
    await ensureSchema(runtime.DB);

    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "delivered";
    const attemptParam = url.searchParams.get("attempt");
    const reasonParam = url.searchParams.get("reason");

    // Standard analytical filter parsing
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
    const product = url.searchParams.get("product")?.trim();

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
    if (product) {
      filters.push("LOWER(products_json) LIKE LOWER(?)");
      filterValues.push(`%${product}%`);
    }

    const baseWhere = filters.length ? filters.join(" AND ") : "1 = 1";

    if (type === "ndr" || reasonParam) {
      // NDR Reason Lightbox Cohort
      const reasonFilter = reasonParam ? `AND ${ndrReasonSql} = ?` : "";
      const ndrFilterValues = reasonParam ? [...filterValues, reasonParam] : filterValues;

      const summaryQuery = `
        SELECT 
          COUNT(*) AS total_incidents,
          SUM(CASE WHEN ${ndrAttemptNumberSql} = 1 THEN 1 ELSE 0 END) AS attempt1_count,
          SUM(CASE WHEN ${ndrAttemptNumberSql} = 2 THEN 1 ELSE 0 END) AS attempt2_count,
          SUM(CASE WHEN ${ndrAttemptNumberSql} >= 3 THEN 1 ELSE 0 END) AS attempt3_plus_count,
          SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS recovered_delivered,
          SUM(CASE WHEN ${rtoSql} THEN 1 ELSE 0 END) AS rto_count,
          AVG(CASE WHEN LENGTH(ndr_raised_at) >= 10 AND LENGTH(shipped_at) >= 10 THEN EXTRACT(EPOCH FROM (ndr_raised_at::timestamptz - shipped_at::timestamptz)) / 86400 END) AS avg_days_to_ndr
        FROM orders
        WHERE ${baseWhere} 
          AND (${ndrSql} OR ndr_attempts > 0 OR (ndr_reason != '' AND ndr_reason IS NOT NULL) OR (ndr_raised_at != '' AND ndr_raised_at IS NOT NULL))
          ${reasonFilter}
      `;

      const courierHistogramQuery = `
        SELECT 
          COALESCE(NULLIF(courier, ''), 'Not assigned') AS courier,
          COUNT(*) AS count
        FROM orders
        WHERE ${baseWhere} 
          AND (${ndrSql} OR ndr_attempts > 0 OR (ndr_reason != '' AND ndr_reason IS NOT NULL) OR (ndr_raised_at != '' AND ndr_raised_at IS NOT NULL))
          ${reasonFilter}
        GROUP BY courier
        ORDER BY count DESC
        LIMIT 10
      `;

      const tatHistogramQuery = `
        SELECT 
          CASE 
            WHEN EXTRACT(EPOCH FROM (COALESCE(NULLIF(ndr_raised_at, ''), NULLIF(out_for_delivery_at, ''))::timestamptz - shipped_at::timestamptz)) / 86400 <= 1 THEN '1 Day'
            WHEN EXTRACT(EPOCH FROM (COALESCE(NULLIF(ndr_raised_at, ''), NULLIF(out_for_delivery_at, ''))::timestamptz - shipped_at::timestamptz)) / 86400 <= 2 THEN '2 Days'
            WHEN EXTRACT(EPOCH FROM (COALESCE(NULLIF(ndr_raised_at, ''), NULLIF(out_for_delivery_at, ''))::timestamptz - shipped_at::timestamptz)) / 86400 <= 3 THEN '3 Days'
            WHEN EXTRACT(EPOCH FROM (COALESCE(NULLIF(ndr_raised_at, ''), NULLIF(out_for_delivery_at, ''))::timestamptz - shipped_at::timestamptz)) / 86400 <= 4 THEN '4 Days'
            WHEN EXTRACT(EPOCH FROM (COALESCE(NULLIF(ndr_raised_at, ''), NULLIF(out_for_delivery_at, ''))::timestamptz - shipped_at::timestamptz)) / 86400 <= 5 THEN '5 Days'
            WHEN EXTRACT(EPOCH FROM (COALESCE(NULLIF(ndr_raised_at, ''), NULLIF(out_for_delivery_at, ''))::timestamptz - shipped_at::timestamptz)) / 86400 <= 7 THEN '6-7 Days'
            ELSE '8+ Days'
          END AS bucket,
          COUNT(*) AS count
        FROM orders
        WHERE ${baseWhere} 
          AND (${ndrSql} OR ndr_attempts > 0 OR (ndr_reason != '' AND ndr_reason IS NOT NULL) OR (ndr_raised_at != '' AND ndr_raised_at IS NOT NULL))
          AND LENGTH(shipped_at) >= 10
          AND (LENGTH(ndr_raised_at) >= 10 OR LENGTH(out_for_delivery_at) >= 10)
          ${reasonFilter}
        GROUP BY bucket
      `;

      const ordersQuery = `
        SELECT 
          id, channel_order_id, awb, courier, customer_name, customer_city, customer_state,
          payment_method, total, order_date, status, ndr_reason, ndr_attempts, attempt_count,
          ndr_raised_at, first_out_for_delivery_at, out_for_delivery_at, delivered_at
        FROM orders
        WHERE ${baseWhere} 
          AND (${ndrSql} OR ndr_attempts > 0 OR (ndr_reason != '' AND ndr_reason IS NOT NULL) OR (ndr_raised_at != '' AND ndr_raised_at IS NOT NULL))
          ${reasonFilter}
        ORDER BY COALESCE(NULLIF(ndr_raised_at, ''), updated_at) DESC
        LIMIT 60
      `;

      const [summaryRes, courierRes, tatRes, ordersRes] = await Promise.all([
        runtime.DB.prepare(summaryQuery).bind(...ndrFilterValues).first<Record<string, unknown>>(),
        runtime.DB.prepare(courierHistogramQuery).bind(...ndrFilterValues).all<{ courier: string; count: number }>(),
        runtime.DB.prepare(tatHistogramQuery).bind(...ndrFilterValues).all<{ bucket: string; count: number }>(),
        runtime.DB.prepare(ordersQuery).bind(...ndrFilterValues).all<Record<string, unknown>>(),
      ]);

      const total = Number(summaryRes?.total_incidents || 0);
      const att1 = Number(summaryRes?.attempt1_count || 0);
      const att2 = Number(summaryRes?.attempt2_count || 0);
      const att3 = Number(summaryRes?.attempt3_plus_count || 0);
      const rec = Number(summaryRes?.recovered_delivered || 0);
      const rto = Number(summaryRes?.rto_count || 0);

      const attemptHistogram = [
        { label: "1st Attempt", count: att1, percent: total > 0 ? round((att1 / total) * 100) : 0, color: "bg-sky-500" },
        { label: "2nd Attempt", count: att2, percent: total > 0 ? round((att2 / total) * 100) : 0, color: "bg-amber-500" },
        { label: "3rd+ Attempt", count: att3, percent: total > 0 ? round((att3 / total) * 100) : 0, color: "bg-rose-500" },
      ];

      const bucketOrder = ["1 Day", "2 Days", "3 Days", "4 Days", "5 Days", "6-7 Days", "8+ Days"];
      const tatMap = new Map((tatRes.results || []).map((r) => [r.bucket, Number(r.count)]));
      const tatHistogram = bucketOrder.map((b) => {
        const count = tatMap.get(b) || 0;
        return {
          bucket: b,
          count,
          percent: total > 0 ? round((count / total) * 100) : 0,
        };
      });

      const courierHistogram = (courierRes.results || []).map((c) => ({
        courier: c.courier,
        count: Number(c.count),
        percent: total > 0 ? round((Number(c.count) / total) * 100) : 0,
      }));

      return Response.json({
        type: "ndr",
        reason: reasonParam || "All NDR Reasons",
        summary: {
          totalIncidents: total,
          attempt1Count: att1,
          attempt1Percent: total > 0 ? round((att1 / total) * 100) : 0,
          attempt2Count: att2,
          attempt2Percent: total > 0 ? round((att2 / total) * 100) : 0,
          attempt3PlusCount: att3,
          attempt3PlusPercent: total > 0 ? round((att3 / total) * 100) : 0,
          recoveredDelivered: rec,
          recoveryRate: total > 0 ? round((rec / total) * 100) : 0,
          rtoCount: rto,
          rtoRate: total > 0 ? round((rto / total) * 100) : 0,
          avgDaysToNdr: summaryRes?.avg_days_to_ndr != null ? round(Number(summaryRes.avg_days_to_ndr)) : null,
        },
        attemptHistogram,
        tatHistogram,
        courierHistogram,
        orders: ordersRes.results || [],
      });
    }

    // Default: Delivery Attempt Cohort
    const attempt = Number(attemptParam || 1);
    const attemptCondition =
      attempt >= 4
        ? `${orderAttemptNumberSql} >= 4`
        : `${orderAttemptNumberSql} = ${attempt}`;

    // Cohort delivered query + overarching shipped cohort numbers
    const summaryQuery = `
      SELECT 
        COUNT(*) AS total_delivered,
        SUM(CASE WHEN LOWER(payment_method) = 'cod' THEN 1 ELSE 0 END) AS cod_delivered,
        SUM(CASE WHEN LOWER(payment_method) = 'prepaid' THEN 1 ELSE 0 END) AS prepaid_delivered,
        COALESCE(SUM(total), 0) AS total_revenue,
        AVG(CASE WHEN LENGTH(delivered_at) >= 10 AND LENGTH(shipped_at) >= 10 THEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 END) AS avg_tat_days
      FROM orders
      WHERE ${baseWhere} AND ${deliveredSql} AND ${attemptCondition}
    `;

    const overarchingQuery = `
      SELECT 
        SUM(CASE WHEN ${openPopulationSql} THEN 1 ELSE 0 END) AS shipped,
        SUM(CASE WHEN ${deliveredSql} THEN 1 ELSE 0 END) AS all_delivered
      FROM orders
      WHERE ${baseWhere}
    `;

    const tatHistogramQuery = `
      SELECT 
        CASE 
          WHEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 <= 1 THEN '1 Day'
          WHEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 <= 2 THEN '2 Days'
          WHEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 <= 3 THEN '3 Days'
          WHEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 <= 4 THEN '4 Days'
          WHEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 <= 5 THEN '5 Days'
          WHEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 <= 7 THEN '6-7 Days'
          ELSE '8+ Days'
        END AS bucket,
        COUNT(*) AS count
      FROM orders
      WHERE ${baseWhere} AND ${deliveredSql} AND ${attemptCondition} AND LENGTH(delivered_at) >= 10 AND LENGTH(shipped_at) >= 10
      GROUP BY bucket
    `;

    const courierHistogramQuery = `
      SELECT 
        COALESCE(NULLIF(courier, ''), 'Not assigned') AS courier,
        COUNT(*) AS count,
        AVG(CASE WHEN LENGTH(delivered_at) >= 10 AND LENGTH(shipped_at) >= 10 THEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 END) AS avg_tat
      FROM orders
      WHERE ${baseWhere} AND ${deliveredSql} AND ${attemptCondition}
      GROUP BY courier
      ORDER BY count DESC
      LIMIT 10
    `;

    const stateHistogramQuery = `
      SELECT 
        COALESCE(NULLIF(customer_state, ''), 'Unknown') AS state,
        COUNT(*) AS count,
        AVG(CASE WHEN LENGTH(delivered_at) >= 10 AND LENGTH(shipped_at) >= 10 THEN EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400 END) AS avg_tat
      FROM orders
      WHERE ${baseWhere} AND ${deliveredSql} AND ${attemptCondition}
      GROUP BY state
      ORDER BY count DESC
      LIMIT 25
    `;

    const ordersQuery = `
      SELECT 
        id, channel_order_id, awb, courier, customer_name, customer_city, customer_state,
        payment_method, total, order_date, status, attempt_count, ndr_attempts,
        delivered_at, first_out_for_delivery_at, out_for_delivery_at,
        ROUND((EXTRACT(EPOCH FROM (delivered_at::timestamptz - shipped_at::timestamptz)) / 86400)::numeric, 1) AS tat_days
      FROM orders
      WHERE ${baseWhere} AND ${deliveredSql} AND ${attemptCondition}
      ORDER BY delivered_at DESC
      LIMIT 60
    `;

    const [summaryRes, overarchingRes, tatRes, courierRes, stateRes, ordersRes] = await Promise.all([
      runtime.DB.prepare(summaryQuery).bind(...filterValues).first<Record<string, unknown>>(),
      runtime.DB.prepare(overarchingQuery).bind(...filterValues).first<Record<string, unknown>>(),
      runtime.DB.prepare(tatHistogramQuery).bind(...filterValues).all<{ bucket: string; count: number }>(),
      runtime.DB.prepare(courierHistogramQuery).bind(...filterValues).all<{ courier: string; count: number; avg_tat: number | null }>(),
      runtime.DB.prepare(stateHistogramQuery).bind(...filterValues).all<{ state: string; count: number; avg_tat: number | null }>(),
      runtime.DB.prepare(ordersQuery).bind(...filterValues).all<Record<string, unknown>>(),
    ]);

    const deliveredCount = Number(summaryRes?.total_delivered || 0);
    const shippedCount = Number(overarchingRes?.shipped || 0);
    const allDeliveredCount = Number(overarchingRes?.all_delivered || 0);

    const deliveryRate = shippedCount > 0 ? round((deliveredCount / shippedCount) * 100) : 0;
    const shareOfDelivered = allDeliveredCount > 0 ? round((deliveredCount / allDeliveredCount) * 100) : 0;

    const bucketOrder = ["1 Day", "2 Days", "3 Days", "4 Days", "5 Days", "6-7 Days", "8+ Days"];
    const tatMap = new Map((tatRes.results || []).map((r) => [r.bucket, Number(r.count)]));
    const tatHistogram = bucketOrder.map((b) => {
      const count = tatMap.get(b) || 0;
      return {
        bucket: b,
        count,
        percent: deliveredCount > 0 ? round((count / deliveredCount) * 100) : 0,
      };
    });

    const courierHistogram = (courierRes.results || []).map((c) => ({
      courier: c.courier,
      count: Number(c.count),
      percent: deliveredCount > 0 ? round((Number(c.count) / deliveredCount) * 100) : 0,
      avgTat: c.avg_tat != null ? round(Number(c.avg_tat)) : null,
    }));

    const stateHistogram = (stateRes.results || []).map((s) => ({
      state: s.state,
      count: Number(s.count),
      percent: deliveredCount > 0 ? round((Number(s.count) / deliveredCount) * 100) : 0,
      avgTat: s.avg_tat != null ? round(Number(s.avg_tat)) : null,
    }));

    return Response.json({
      type: "delivered",
      attempt,
      summary: {
        attempt,
        deliveredCount,
        shippedCount,
        allDeliveredCount,
        deliveryRate, // % of Shipped (FADR for attempt 1)
        shareOfDelivered, // % of all delivered packages
        avgTatDays: summaryRes?.avg_tat_days != null ? round(Number(summaryRes.avg_tat_days)) : null,
        totalRevenue: Number(summaryRes?.total_revenue || 0),
        codCount: Number(summaryRes?.cod_delivered || 0),
        prepaidCount: Number(summaryRes?.prepaid_delivered || 0),
      },
      tatHistogram,
      courierHistogram,
      stateHistogram,
      orders: ordersRes.results || [],
    });
  } catch (error) {
    console.error("Failed to load attempt cohort analytics:", error);
    return Response.json({ error: "Failed to load attempt cohort analytics" }, { status: 500 });
  }
}
