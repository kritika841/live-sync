import { type PostgresDatabase } from "./database";

export const DEFAULT_HIGH_RTO_CAMPAIGN_ID = "cmp_default_high_rto";
export const HIGH_RISK_TAGS = ["high", "very high", "rto prediction high", "high rto", "high risk"];

export const HIGH_RISK_TAG_SQL = `(
  raw_json::jsonb->'shopify_tags' @> '"high"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"rto_prediction_high"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"very-high"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"high_rto"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"high_risk"'::jsonb
  OR raw_json::jsonb->'tags' @> '"high"'::jsonb
  OR raw_json::jsonb->'tags' @> '"rto_prediction_high"'::jsonb
  OR raw_json::jsonb->'tags' @> '"very-high"'::jsonb
  OR raw_json::jsonb->'tags' @> '"high_rto"'::jsonb
  OR raw_json::jsonb->'tags' @> '"high_risk"'::jsonb
  OR (raw_json::jsonb->>'order_tag' IS NOT NULL AND LOWER(raw_json::jsonb->>'order_tag') ~* '\\m(high|very-high|rto_prediction_high|high_rto|high_risk)\\M')
  OR (raw_json::jsonb->>'sr_tags' IS NOT NULL AND LOWER(raw_json::jsonb->>'sr_tags') ~* '\\m(high|very-high|rto_prediction_high|high_rto|high_risk)\\M')
  OR (raw_json::jsonb->>'tags' IS NOT NULL AND jsonb_typeof(raw_json::jsonb->'tags') = 'string' AND LOWER(raw_json::jsonb->>'tags') ~* '\\m(high|very-high|rto_prediction_high|high_rto|high_risk)\\M')
)`;

export const HIGH_RISK_SQL = `(LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high') OR ${HIGH_RISK_TAG_SQL})`;
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

export function isOrderHighRisk(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw) return false;
  const risk = normalized(raw.rto_risk);
  if (risk === "high" || risk === "very high") return true;
  const tags = extractOrderTags(raw).map(normalized);
  return tags.some((tag) => HIGH_RISK_TAGS.includes(tag));
}

function campaignMatches(order: RoutingOrder, criteria: CampaignCriteria) {
  // Prepaid orders must NEVER go for confirmation
  if (normalized(order.paymentMethod) === "prepaid") return false;
  const raw = JSON.parse(order.rawJson || "{}") as Record<string, unknown>;
  const highRisk = isOrderHighRisk(raw);
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
  const assignments: Array<{ campaignId: string; orderId: number; position: number; createdAt: string }> = [];
  const pendingOrderIds: number[] = [];
  const highRiskOrderIds: number[] = [];
  const prepaidCleanupIds: number[] = [];

  for (const order of orderResult.results) {
    const raw = JSON.parse(order.rawJson || "{}") as Record<string, unknown>;
    const highRisk = isOrderHighRisk(raw);
    if (highRisk) {
      highRiskOrderIds.push(order.id);
    }

    // Prepaid orders must NEVER go for confirmation even if they have the high risk tag
    if (normalized(order.paymentMethod) === "prepaid") {
      if (order.confirmationStatus === "pending") {
        prepaidCleanupIds.push(order.id);
      }
      continue;
    }

    if (["confirmed", "rejected"].includes(order.confirmationStatus)) continue;
    const campaign = highRisk
      ? campaignResult.results.find((item) => item.id === DEFAULT_HIGH_RTO_CAMPAIGN_ID)
      : campaignResult.results.find((item) => campaignMatches(order, JSON.parse(item.criteriaJson || "{}") as CampaignCriteria));
    if (!campaign) continue;
    assignments.push({ campaignId: campaign.id, orderId: order.id, position: Date.now(), createdAt: now });
    if (actionable(order.status) && order.confirmationStatus === "not_required") {
      pendingOrderIds.push(order.id);
    }
  }

  if (prepaidCleanupIds.length) {
    const placeholders = prepaidCleanupIds.map(() => "?").join(", ");
    await db.prepare(`
      UPDATE orders SET confirmation_status='not_required', confirmation_updated_at=?
      WHERE id IN (${placeholders})
    `).bind(now, ...prepaidCleanupIds).run().catch(() => null);
    await db.prepare(`
      DELETE FROM campaign_assignments WHERE order_id IN (${placeholders})
    `).bind(...prepaidCleanupIds).run().catch(() => null);
  }
  if (assignments.length) {
    const rowPlaceholders = assignments.map(() => "(?, ?, ?, ?)").join(", ");
    const values = assignments.flatMap((a) => [a.campaignId, a.orderId, a.position, a.createdAt]);
    await db.prepare(`
      INSERT INTO campaign_assignments (campaign_id, order_id, position, created_at)
      VALUES ${rowPlaceholders}
      ON CONFLICT(order_id) DO UPDATE SET campaign_id=excluded.campaign_id
      WHERE excluded.campaign_id='${DEFAULT_HIGH_RTO_CAMPAIGN_ID}'
    `).bind(...values).run();
  }
  if (pendingOrderIds.length) {
    const placeholders = pendingOrderIds.map(() => "?").join(", ");
    await db.prepare(`
      UPDATE orders SET confirmation_status='pending', confirmation_updated_at=?
      WHERE id IN (${placeholders}) AND confirmation_status='not_required'
    `).bind(now, ...pendingOrderIds).run();
  }
  if (highRiskOrderIds.length) {
    const placeholders = highRiskOrderIds.map(() => "?").join(", ");
    await db.prepare(`
      UPDATE orders SET is_high_risk=TRUE
      WHERE id IN (${placeholders}) AND is_high_risk=FALSE
    `).bind(...highRiskOrderIds).run().catch(() => null);
  }
}
