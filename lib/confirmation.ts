import { type PostgresDatabase } from "./database";

export const DEFAULT_HIGH_RTO_CAMPAIGN_ID = "cmp_default_high_rto";
export const HIGH_RISK_SQL = "LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')";
export const ACTIONABLE_STATUS_SQL = "UPPER(status) NOT LIKE '%DELIVERED%' AND UPPER(status) NOT LIKE 'RTO%' AND UPPER(status) NOT LIKE '%CANCEL%'";

type CampaignCriteria = {
  risk?: "all" | "high" | "low";
  paymentMethod?: "ANY" | "COD" | "PREPAID";
  tags?: string[];
  productNames?: string[];
  dateFrom?: string;
  dateTo?: string;
};

type RoutingOrder = {
  id: number;
  paymentMethod: string;
  productsJson: string;
  rawJson: string;
  orderDate: string;
  status: string;
  confirmationStatus: string;
};

const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ");

export function extractOrderTags(raw: Record<string, unknown>) {
  const values = [raw.shopify_tags, raw.order_tag, raw.sr_tags, raw.tags].flatMap((value) => Array.isArray(value) ? value : String(value ?? "").split(","));
  const tags = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  return [...new Map(tags.map((tag) => [normalized(tag), tag])).values()];
}

function campaignMatches(order: RoutingOrder, criteria: CampaignCriteria) {
  const raw = JSON.parse(order.rawJson || "{}") as Record<string, unknown>;
  const risk = normalized(raw.rto_risk);
  const highRisk = risk === "high" || risk === "very high";
  if (criteria.risk === "high" && !highRisk) return false;
  if (criteria.risk === "low" && highRisk) return false;
  const paymentMethod = normalized(criteria.paymentMethod);
  if (paymentMethod && !["all", "any"].includes(paymentMethod) && normalized(order.paymentMethod) !== paymentMethod) return false;
  if (criteria.tags?.length) {
    const tags = extractOrderTags(raw).map(normalized);
    if (!criteria.tags.every((tag) => tags.includes(normalized(tag)))) return false;
  }
  const orderDate = order.orderDate.slice(0, 10);
  if ((criteria.dateFrom || criteria.dateTo) && !orderDate) return false;
  if (criteria.dateFrom && orderDate < criteria.dateFrom) return false;
  if (criteria.dateTo && orderDate > criteria.dateTo) return false;
  if (criteria.productNames?.length) {
    const products = JSON.parse(order.productsJson || "[]") as Array<Record<string, unknown>>;
    if (!criteria.productNames.some((name) => products.some((product) => normalized(product.name) === normalized(name)))) return false;
  }
  return true;
}

function actionable(status: string) {
  const value = status.toUpperCase();
  return !value.includes("DELIVERED") && !value.startsWith("RTO") && !value.includes("CANCEL");
}

export async function routeConfirmationOrders(db: PostgresDatabase, orderIds: number[]) {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (!ids.length) return;
  const [campaignResult, orderResult] = await Promise.all([
    db.prepare("SELECT id, criteria_json AS criteriaJson, position FROM campaigns WHERE is_active=TRUE AND auto_assign=TRUE ORDER BY position, created_at").all<{ id: string; criteriaJson: string; position: number }>(),
    db.prepare(`SELECT id, payment_method AS paymentMethod, products_json AS productsJson, raw_json AS rawJson, order_date AS orderDate, status,
      confirmation_status AS confirmationStatus FROM orders WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<RoutingOrder>(),
  ]);
  const now = new Date().toISOString();
  const statements = [];
  for (const order of orderResult.results) {
    if (["confirmed", "rejected"].includes(order.confirmationStatus)) continue;
    const raw = JSON.parse(order.rawJson || "{}") as Record<string, unknown>;
    const risk = normalized(raw.rto_risk);
    const highRisk = risk === "high" || risk === "very high";
    const campaign = highRisk
      ? campaignResult.results.find((item) => item.id === DEFAULT_HIGH_RTO_CAMPAIGN_ID)
      : campaignResult.results.find((item) => campaignMatches(order, JSON.parse(item.criteriaJson || "{}") as CampaignCriteria));
    if (!campaign) continue;
    statements.push(db.prepare(`INSERT INTO campaign_assignments (campaign_id, order_id, position, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(order_id) DO UPDATE SET campaign_id=excluded.campaign_id
      WHERE excluded.campaign_id=?`).bind(campaign.id, order.id, Date.now(), now, DEFAULT_HIGH_RTO_CAMPAIGN_ID));
    if (actionable(order.status) && order.confirmationStatus === "not_required") {
      statements.push(db.prepare("UPDATE orders SET confirmation_status='pending', confirmation_updated_at=? WHERE id=? AND confirmation_status='not_required'").bind(now, order.id));
    }
  }
  if (statements.length) await db.batch(statements);
}
