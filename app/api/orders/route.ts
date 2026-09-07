import { ensureSchema, getRuntimeEnv } from "../../../lib/database";
import { sqlForTab, statusTab, type OrderTab } from "../../../lib/order-status";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const url = new URL(request.url);
  const requestedTab = url.searchParams.get("tab") || "new";
  const tab = (["new", "ready", "shipped", "out_for_delivery", "undelivered", "delivered", "rto", "all"].includes(requestedTab) ? requestedTab : "new") as OrderTab;
  const requestedRisk = url.searchParams.get("risk");
  const risk = requestedRisk === "high" || requestedRisk === "low" || requestedRisk === "approved" ? requestedRisk : "all";
  const approved = risk === "approved";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const sort = url.searchParams.get("sort") === "oldest" ? "ASC" : "DESC";
  const perPage = 50;
  const filters: string[] = [];
  const filterValues: unknown[] = [];
  const search = url.searchParams.get("search")?.trim();
  const payment = url.searchParams.get("payment")?.trim();
  const courier = url.searchParams.get("courier")?.trim();
  const pickup = url.searchParams.get("pickup")?.trim();
  const deliveredDate = url.searchParams.get("delivered_date")?.trim();
  let from = url.searchParams.get("from")?.trim();
  let to = url.searchParams.get("to")?.trim();
  if (from && to && from > to) [from, to] = [to, from];

  if (!approved && search) {
    filters.push("(channel_order_id LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? OR customer_phone LIKE ? OR awb LIKE ? OR products_json LIKE ?)");
    const term = `%${search}%`;
    filterValues.push(term, term, term, term, term, term);
  }
  if (!approved && payment) { filters.push("LOWER(payment_method) = LOWER(?)"); filterValues.push(payment); }
  if (!approved && courier) { filters.push("LOWER(courier) LIKE LOWER(?)"); filterValues.push(`%${courier}%`); }
  if (!approved && pickup) { filters.push("LOWER(pickup_location) LIKE LOWER(?)"); filterValues.push(`%${pickup}%`); }
  if (!approved && from) { filters.push("SUBSTR(order_date, 1, 10) >= ?"); filterValues.push(from); }
  if (!approved && to) { filters.push("SUBSTR(order_date, 1, 10) <= ?"); filterValues.push(to); }
  if (!approved && deliveredDate && tab === "delivered") { filters.push("SUBSTR(delivered_at, 1, 10) = ?"); filterValues.push(deliveredDate); }

  const highRiskSql = "LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')";
  const riskSql = risk === "high" ? highRiskSql : risk === "low" ? `NOT (${highRiskSql})` : "1 = 1";
  const filterSql = filters.length ? filters.join(" AND ") : "1 = 1";
  const where = approved ? ["confirmation_status = 'confirmed'"] : [sqlForTab(tab), riskSql, ...filters];
  const whereSql = where.join(" AND ");
  const orderBy = approved ? "COALESCE(NULLIF(confirmed_at, ''), confirmation_updated_at) DESC, id DESC" : `COALESCE(NULLIF(order_date, ''), created_at) ${sort}, id ${sort}`;
  const countRow = await runtime.DB.prepare(`SELECT COUNT(*) AS total FROM orders WHERE ${whereSql}`).bind(...filterValues).first<{ total: number }>();
  if (url.searchParams.get("selection") === "all") {
    const allOrders = await runtime.DB.prepare(`
      SELECT id, channel_order_id AS channelOrderId
      FROM orders WHERE ${whereSql}
      ORDER BY ${orderBy}
    `).bind(...filterValues).all<{ id: number; channelOrderId: string }>();
    return Response.json({ orders: allOrders.results, total: Number(countRow?.total || 0) });
  }
  const rows = await runtime.DB.prepare(`
    SELECT id, channel_order_id AS channelOrderId, channel_name AS channelName,
      customer_name AS customerName, customer_email AS customerEmail,
      customer_phone AS customerPhone, customer_city AS customerCity,
      customer_state AS customerState, COALESCE(NULLIF(order_date, ''), created_at) AS orderDate,
      delivered_at AS deliveredAt, status,
      payment_method AS paymentMethod, payment_status AS paymentStatus, total,
      pickup_location AS pickupLocation, awb, courier, products_json AS productsJson,
      synced_at AS syncedAt, confirmation_status AS confirmationStatus,
      confirmation_updated_at AS confirmationUpdatedAt, confirmed_at AS confirmedAt, rejected_at AS rejectedAt
    FROM orders WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).bind(...filterValues, perPage, (page - 1) * perPage).all<Record<string, unknown>>();

  const grouped = await runtime.DB.prepare(`
    SELECT status, COUNT(*) AS total FROM orders
    WHERE ${riskSql} AND ${filterSql}
    GROUP BY status
  `).bind(...filterValues).all<{ status: string; total: number }>();
  const counts = { new: 0, ready: 0, shipped: 0, out_for_delivery: 0, undelivered: 0, delivered: 0, rto: 0, all: 0 };
  for (const row of grouped.results) {
    const total = Number(row.total || 0);
    const bucket = statusTab(row.status);
    if (bucket !== "other") counts[bucket] += total;
    counts.all += total;
  }
  const riskCountRow = await runtime.DB.prepare(`
    SELECT
      SUM(CASE WHEN ${highRiskSql} THEN 0 ELSE 1 END) AS low,
      SUM(CASE WHEN ${highRiskSql} THEN 1 ELSE 0 END) AS high
    FROM orders
    WHERE ${sqlForTab(tab)} AND ${filterSql}
  `).bind(...filterValues).first<{ low: number; high: number }>();
  const approvedCountRow = await runtime.DB.prepare("SELECT COUNT(*) AS total FROM orders WHERE confirmation_status='confirmed'").first<{ total: number }>();
  const stateRows = await runtime.DB.prepare(`
    SELECT key, value FROM sync_state
    WHERE key NOT IN ('shiprocket_token', 'shiprocket_token_expires_at', 'shiprocket_auth_retry_after')
  `).all<{ key: string; value: string }>();
  const sync = Object.fromEntries(stateRows.results.map((row) => [row.key, row.value]));
  const couriers = await runtime.DB.prepare("SELECT DISTINCT courier FROM orders WHERE courier != '' ORDER BY courier").all<{ courier: string }>();
  const pickups = await runtime.DB.prepare("SELECT DISTINCT pickup_location AS pickup FROM orders WHERE pickup_location != '' ORDER BY pickup_location").all<{ pickup: string }>();

  return Response.json({
    orders: rows.results.map((row) => ({ ...row, products: JSON.parse(String(row.productsJson || "[]")), productsJson: undefined })),
    counts,
    riskCounts: {
      all: Number(riskCountRow?.low || 0) + Number(riskCountRow?.high || 0),
      low: Number(riskCountRow?.low || 0),
      high: Number(riskCountRow?.high || 0),
      approved: Number(approvedCountRow?.total || 0),
    },
    total: Number(countRow?.total || 0),
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(Number(countRow?.total || 0) / perPage)),
    sync,
    filterOptions: { couriers: couriers.results.map((row) => row.courier), pickups: pickups.results.map((row) => row.pickup) },
  });
}
