import {tagRowsSql} from "../../../lib/order-tags-sql";
import { errorResponse } from "../../../lib/http";
import { ensureCopiedOrdersSchema, getRuntimeEnv } from "../../../lib/database";
import { sqlForTab, statusTab, type OrderTab } from "../../../lib/order-status";
import { requireApiUser } from "../../../lib/auth/access";

import {cachedValue} from "../../../lib/server-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { return await loadOrders(request); } catch (error) { return errorResponse(error); }
}
async function loadOrders(request: Request) {
  const access = await requireApiUser();
  if (access.response) return access.response;
  const runtime = getRuntimeEnv();
  await ensureCopiedOrdersSchema(runtime.DB);
  const url = new URL(request.url);
  const requestedTab = url.searchParams.get("tab") || "new";
  const tab = (["new", "ready", "shipped", "out_for_delivery", "undelivered", "delivered", "rto", "all"].includes(requestedTab) ? requestedTab : "new") as OrderTab;
  const requestedRisk = url.searchParams.get("risk");
  const risk = ["high", "low"].includes(requestedRisk || "") || (tab === "new" && ["approved", "low_approved"].includes(requestedRisk || "")) ? requestedRisk : "all";
  const approved = risk === "approved";
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const sort = url.searchParams.get("sort") === "oldest" ? "ASC" : "DESC";
  const requestedPerPage = Math.max(1, Math.min(400, Number(url.searchParams.get("perPage")) || 50));
  const perPage = requestedPerPage;

  // Proactively keep dashboard fresh: if > 90 seconds since last sync, trigger fast sync of newest orders
  const lastSyncRow = await runtime.DB.prepare(
    "SELECT value FROM sync_state WHERE key = 'last_sync_at'"
  ).first<{ value: string }>().catch(() => null);
  const lastSyncTime = Date.parse(lastSyncRow?.value || "");
  if (!lastSyncTime || Date.now() - lastSyncTime > 90000) {
    import("../../../lib/shiprocket").then(({ syncRecentOrders }) => {
      syncRecentOrders(runtime).catch(() => {});
    });
  }
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
  if (deliveredDate && tab === "delivered") { filters.push("SUBSTR(delivered_at, 1, 10) = ?"); filterValues.push(deliveredDate); }

const DEFAULT_ORDER_TAGS = [
  "Abandoned Orders", "Agent", "B2G1", "bankOffer", "BOGO", "Cards", "COD",
  "Duplicate", "easysell_cod_form", "fastrr", "GoKwik", "Gokwik_cod_fees",
  "Gokwik_cod_prompt", "Gokwik_ppcod_upi", "high", "Influencer", "Landing KARUNGALI",
  "Landing: ALL-PRODUCTS", "Landing: BUY-2-KARUNGALI", "Landing: INCENSE-STICKS",
  "Landing: KARUNGALI", "Landing: RUDRAKSHA", "low", "Netbanking", "ops-cancelled",
  "ops-confirmed", "Order modified by Buyer", "ORDER_CANCELLED", "ORDER_CONFIRMED",
  "Order_Recovery", "pickup-prioritization", "PPCOD-UPI", "PREPAID-DISCOUNT",
  "Refund_credited", "Refund_initiated", "RTO Delivered via Shiprocket",
  "RTO Initiated via Shiprocket", "RTO Rejected via Shiprocket", "rto_prediction_high",
  "rtorejected", "Standard", "UPI", "very-high", "Wallets"
];

  const tag = url.searchParams.get("tag")?.trim();

  if (tag) { filters.push(`EXISTS (${tagRowsSql} WHERE LOWER(TRIM(tag_value))=LOWER(?))`); filterValues.push(tag); }

  const copied = url.searchParams.get("copied")?.trim();
  if (copied === "yes" || copied === "true" || copied === "copied") {
    filters.push("copied_at <> ''");
  } else if (copied === "no" || copied === "false" || copied === "uncopied") {
    filters.push("(copied_at IS NULL OR copied_at = '')");
  }

  const windowDaysRow = await runtime.DB.prepare(
    "SELECT value FROM sync_state WHERE key = 'unshipped_orders_window_days'"
  ).first<{ value: string }>();
  const unshippedOrdersWindowDays = Math.max(1, Math.min(365, parseInt(windowDaysRow?.value || "30", 10) || 30));
  const cutoffDate = new Date(Date.now() - unshippedOrdersWindowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  if (tab === "new" && !from) {
    filters.push("SUBSTR(COALESCE(NULLIF(order_date, ''), created_at), 1, 10) >= ?");
    filterValues.push(cutoffDate);
  }

  const riskSql = risk === "high" ? "is_high_risk = TRUE" : risk === "low" ? "is_high_risk = FALSE" : risk === "approved" ? "confirmation_status = 'confirmed'" : risk === "low_approved" ? "(is_high_risk = FALSE OR confirmation_status = 'confirmed')" : "1 = 1";
  const filterSql = filters.length ? filters.join(" AND ") : "1 = 1";
  const where = [sqlForTab(tab), riskSql, ...filters];
  const whereSql = where.join(" AND ");
  const orderBy = approved ? "COALESCE(NULLIF(confirmed_at, ''), confirmation_updated_at) DESC, id DESC" : `COALESCE(NULLIF(order_date, ''), created_at) ${sort}, id ${sort}`;
  if (url.searchParams.get("selection") === "all") {
    const allOrders = await runtime.DB.prepare(`
      SELECT id, channel_order_id AS channelOrderId
      FROM orders WHERE ${whereSql}
      ORDER BY ${orderBy}
    `).bind(...filterValues).all<{ id: number; channelOrderId: string }>();
    return Response.json({ orders: allOrders.results, total: allOrders.results.length });
  }
  const rowsPromise = runtime.DB.prepare(`
    SELECT id, channel_order_id AS channelOrderId, channel_name AS channelName,
      customer_name AS customerName, customer_email AS customerEmail,
      customer_phone AS customerPhone, customer_city AS customerCity,
      customer_state AS customerState, COALESCE(NULLIF(order_date, ''), created_at) AS orderDate,
      delivered_at AS deliveredAt, status,
      payment_method AS paymentMethod, payment_status AS paymentStatus, total,
      pickup_location AS pickupLocation, awb, courier, products_json AS productsJson,
      synced_at AS syncedAt, confirmation_status AS confirmationStatus,
      confirmation_updated_at AS confirmationUpdatedAt, confirmed_at AS confirmedAt, rejected_at AS rejectedAt,
      copied_at AS copiedAt, copied_by AS copiedBy, copied_by_name AS copiedByName, copied_count AS copiedCount,
      (SELECT note FROM confirmation_attempts a WHERE a.order_id=orders.id AND a.outcome='confirmed' ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS "confirmationNote"
    FROM orders WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).bind(...filterValues, perPage, (page - 1) * perPage).all<Record<string, unknown>>();

  const groupedPromise = filterSql === "1 = 1"
    ? cachedValue(`order-grouped-counts-${unshippedOrdersWindowDays}`, 30000, async () => {
        return runtime.DB.prepare(`
          SELECT status, is_high_risk AS "isHigh", confirmation_status AS "confirmationStatus",
            CASE 
              WHEN UPPER(TRIM(status)) IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING')
                   AND SUBSTR(COALESCE(NULLIF(order_date, ''), created_at), 1, 10) < ?
              THEN TRUE ELSE FALSE 
            END AS "isHistoric",
            COUNT(*) AS total 
          FROM orders 
          GROUP BY status, is_high_risk, confirmation_status, "isHistoric"
        `).bind(cutoffDate).all<{status:string;isHigh:boolean;confirmationStatus:string;isHistoric:boolean;total:number}>();
      })
    : runtime.DB.prepare(`
        SELECT status, is_high_risk AS "isHigh", confirmation_status AS "confirmationStatus",
          CASE 
            WHEN UPPER(TRIM(status)) IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING')
                 AND SUBSTR(COALESCE(NULLIF(order_date, ''), created_at), 1, 10) < ?
              THEN TRUE ELSE FALSE 
          END AS "isHistoric",
          COUNT(*) AS total 
        FROM orders 
        WHERE ${filterSql} 
        GROUP BY status, is_high_risk, confirmation_status, "isHistoric"
      `).bind(cutoffDate, ...filterValues).all<{status:string;isHigh:boolean;confirmationStatus:string;isHistoric:boolean;total:number}>();

  const optionsPromise = cachedValue("order-options", 86400000, async () => {
    const [couriers,pickups] = await Promise.all([
      runtime.DB.prepare("SELECT DISTINCT courier FROM orders WHERE courier<>'' ORDER BY courier").all<{courier:string}>(),
      runtime.DB.prepare("SELECT DISTINCT pickup_location AS pickup FROM orders WHERE pickup_location<>'' ORDER BY pickup_location").all<{pickup:string}>(),
    ]);
    return {couriers:couriers.results.map(r=>r.courier),pickups:pickups.results.map(r=>r.pickup),tags:DEFAULT_ORDER_TAGS};
  }, { couriers: [], pickups: [], tags: DEFAULT_ORDER_TAGS });
  const statePromise = runtime.DB.prepare(`SELECT key,value FROM sync_state WHERE key IN ('sync_status','last_sync_at','last_sync_count','last_sync_error')`).all<{key:string;value:string}>();
  const [rows,grouped,filterOptions,stateRows] = await Promise.all([rowsPromise,groupedPromise,optionsPromise,statePromise]);
  const counts = {new:0,ready:0,shipped:0,out_for_delivery:0,undelivered:0,delivered:0,rto:0,all:0};
  const riskCounts = {all:0,low:0,high:0,approved:0,low_approved:0};
  let total=0;
  for(const row of grouped.results) {
    const count=Number(row.total), bucket=statusTab(row.status), confirmed=row.confirmationStatus==='confirmed';
    const matchesRisk=risk==='high' ? row.isHigh : risk==='low' ? !row.isHigh : risk==='approved' ? confirmed : risk==='low_approved' ? (!row.isHigh||confirmed) : true;
    
    // Omit prehistoric unshipped orders from the "new" count
    if (bucket === "new" && row.isHistoric) {
      continue;
    }

    if(matchesRisk) {counts.all+=count;if(bucket!=='other')counts[bucket]+=count;}
    if(tab==='all'||bucket===tab) {
      riskCounts.all+=count; riskCounts[row.isHigh?'high':'low']+=count;
      if(confirmed)riskCounts.approved+=count;
      if(!row.isHigh||confirmed)riskCounts.low_approved+=count;
      if(matchesRisk)total+=count;
    }
  }
  const sync=Object.fromEntries(stateRows.results.map(row=>[row.key,row.value]));

  return Response.json({
    orders: rows.results.map((row) => ({ ...row, products: safeProducts(row.productsJson), productsJson: undefined })),
    counts,
    riskCounts,
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    sync,
    filterOptions,
    unshippedOrdersWindowDays,
  });
}

function safeProducts(value: unknown) { try { const data=JSON.parse(String(value || "[]")); return Array.isArray(data) ? data : []; } catch { return []; } }
