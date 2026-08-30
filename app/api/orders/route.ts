import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureSchema, getRuntimeEnv } from "../../../lib/database";
import { sqlForTab, statusTab, type OrderTab } from "../../../lib/order-status";

export const dynamic = "force-dynamic";

async function isAllowed() {
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(await getChatGPTUser());
}

export async function GET(request: Request) {
  if (!(await isAllowed())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const url = new URL(request.url);
  const requestedTab = url.searchParams.get("tab") || "new";
  const tab = (["new", "ready", "shipped", "out_for_delivery", "undelivered", "delivered", "rto", "all"].includes(requestedTab) ? requestedTab : "new") as OrderTab;
  const risk = url.searchParams.get("risk") === "high" ? "high" : "low";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const sort = url.searchParams.get("sort") === "oldest" ? "ASC" : "DESC";
  const perPage = 50;
  const filters: string[] = [];
  const filterValues: unknown[] = [];
  const search = url.searchParams.get("search")?.trim();
  const payment = url.searchParams.get("payment")?.trim();
  const courier = url.searchParams.get("courier")?.trim();
  const pickup = url.searchParams.get("pickup")?.trim();
  let from = url.searchParams.get("from")?.trim();
  let to = url.searchParams.get("to")?.trim();
  if (from && to && from > to) [from, to] = [to, from];

  if (search) {
    filters.push("(channel_order_id LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? OR customer_phone LIKE ? OR awb LIKE ? OR products_json LIKE ?)");
    const term = `%${search}%`;
    filterValues.push(term, term, term, term, term, term);
  }
  if (payment) { filters.push("LOWER(payment_method) = LOWER(?)"); filterValues.push(payment); }
  if (courier) { filters.push("LOWER(courier) LIKE LOWER(?)"); filterValues.push(`%${courier}%`); }
  if (pickup) { filters.push("LOWER(pickup_location) LIKE LOWER(?)"); filterValues.push(`%${pickup}%`); }
  if (from) { filters.push("SUBSTR(order_date, 1, 10) >= ?"); filterValues.push(from); }
  if (to) { filters.push("SUBSTR(order_date, 1, 10) <= ?"); filterValues.push(to); }

  const highRiskSql = "LOWER(REPLACE(REPLACE(COALESCE(json_extract(raw_json, '$.rto_risk'), ''), '_', ' '), '-', ' ')) IN ('high', 'very high')";
  const riskSql = risk === "high" ? highRiskSql : `NOT (${highRiskSql})`;
  const filterSql = filters.length ? filters.join(" AND ") : "1 = 1";
  const where = [sqlForTab(tab), riskSql, ...filters];
  const whereSql = where.join(" AND ");
  const countRow = await runtime.DB.prepare(`SELECT COUNT(*) AS total FROM orders WHERE ${whereSql}`).bind(...filterValues).first<{ total: number }>();
  const rows = await runtime.DB.prepare(`
    SELECT id, channel_order_id AS channelOrderId, channel_name AS channelName,
      customer_name AS customerName, customer_email AS customerEmail,
      customer_phone AS customerPhone, customer_city AS customerCity,
      customer_state AS customerState, COALESCE(NULLIF(order_date, ''), created_at) AS orderDate, status,
      payment_method AS paymentMethod, payment_status AS paymentStatus, total,
      pickup_location AS pickupLocation, awb, courier, products_json AS productsJson,
      synced_at AS syncedAt
    FROM orders WHERE ${whereSql}
    ORDER BY COALESCE(NULLIF(order_date, ''), created_at) ${sort}, id ${sort}
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
    riskCounts: { low: Number(riskCountRow?.low || 0), high: Number(riskCountRow?.high || 0) },
    total: Number(countRow?.total || 0),
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(Number(countRow?.total || 0) / perPage)),
    sync,
    filterOptions: { couriers: couriers.results.map((row) => row.courier), pickups: pickups.results.map((row) => row.pickup) },
  });
}
