import { type PostgresDatabase } from "./database";

export const DEFAULT_HIGH_RTO_CAMPAIGN_ID = "cmp_default_high_rto";
export const HIGH_RISK_TAGS = [
  "high",
  "very high",
  "very-high",
  "very_high",
  "rto prediction high",
  "rto_prediction_high",
  "high rto",
  "high_rto",
  "high risk",
  "high_risk",
  "rto high",
  "rto_high",
  "rto risk high",
  "rto_risk_high",
  "buyer risk high",
  "buyer_risk_high",
  "cart_upsell",
  "cart upsell",
  "cart-upsell",
  "upsell_cart",
  "upsell cart",
  "upsell-cart",
  "upsell_order",
  "upsell order",
  "custom_cart_upsell",
  "custom cart upsell",
];

export const CART_UPSELL_TAGS = [
  "cart_upsell",
  "cart upsell",
  "cart-upsell",
  "upsell_cart",
  "upsell cart",
  "upsell-cart",
  "upsell_order",
  "upsell order",
  "custom_cart_upsell",
  "custom cart upsell",
];

export const HIGH_RISK_TAG_SQL = `(
  raw_json::jsonb->'shopify_tags' @> '"high"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"rto_prediction_high"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"very-high"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"high_rto"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"high_risk"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"cart_upsell"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"cart-upsell"'::jsonb
  OR raw_json::jsonb->'shopify_tags' @> '"upsell_cart"'::jsonb
  OR raw_json::jsonb->'order_tag' @> '"high"'::jsonb
  OR raw_json::jsonb->'order_tag' @> '"rto_prediction_high"'::jsonb
  OR raw_json::jsonb->'order_tag' @> '"very-high"'::jsonb
  OR raw_json::jsonb->'order_tag' @> '"high_rto"'::jsonb
  OR raw_json::jsonb->'order_tag' @> '"high_risk"'::jsonb
  OR raw_json::jsonb->'order_tag' @> '"cart_upsell"'::jsonb
  OR raw_json::jsonb->'order_tag' @> '"cart-upsell"'::jsonb
  OR raw_json::jsonb->'order_tag' @> '"upsell_cart"'::jsonb
  OR raw_json::jsonb->'tags' @> '"high"'::jsonb
  OR raw_json::jsonb->'tags' @> '"rto_prediction_high"'::jsonb
  OR raw_json::jsonb->'tags' @> '"very-high"'::jsonb
  OR raw_json::jsonb->'tags' @> '"high_rto"'::jsonb
  OR raw_json::jsonb->'tags' @> '"high_risk"'::jsonb
  OR raw_json::jsonb->'tags' @> '"cart_upsell"'::jsonb
  OR raw_json::jsonb->'tags' @> '"cart-upsell"'::jsonb
  OR raw_json::jsonb->'tags' @> '"upsell_cart"'::jsonb
  OR (raw_json::jsonb->>'order_tag' IS NOT NULL AND LOWER(raw_json::jsonb->>'order_tag') ~* '(high|very[-_ ]high|rto[-_ ]prediction[-_ ]high|high[-_ ]rto|high[-_ ]risk|rto[-_ ]high|cart[-_ ]upsell|upsell[-_ ]cart|upsell[-_ ]order|custom[-_ ]cart[-_ ]upsell)')
  OR (raw_json::jsonb->>'sr_tags' IS NOT NULL AND LOWER(raw_json::jsonb->>'sr_tags') ~* '(high|very[-_ ]high|rto[-_ ]prediction[-_ ]high|high[-_ ]rto|high[-_ ]risk|rto[-_ ]high|cart[-_ ]upsell|upsell[-_ ]cart|upsell[-_ ]order|custom[-_ ]cart[-_ ]upsell)')
  OR (raw_json::jsonb->>'tags' IS NOT NULL AND LOWER(raw_json::jsonb->>'tags') ~* '(high|very[-_ ]high|rto[-_ ]prediction[-_ ]high|high[-_ ]rto|high[-_ ]risk|rto[-_ ]high|cart[-_ ]upsell|upsell[-_ ]cart|upsell[-_ ]order|custom[-_ ]cart[-_ ]upsell)')
  OR (raw_json::jsonb->>'shopify_tags' IS NOT NULL AND LOWER(raw_json::jsonb->>'shopify_tags') ~* '(high|very[-_ ]high|rto[-_ ]prediction[-_ ]high|high[-_ ]rto|high[-_ ]risk|rto[-_ ]high|cart[-_ ]upsell|upsell[-_ ]cart|upsell[-_ ]order|custom[-_ ]cart[-_ ]upsell)')
  OR LOWER(COALESCE(raw_json::jsonb->>'cart_upsell', '')) IN ('true', '1', 'yes')
  OR (raw_json::jsonb->>'shopify_attributes' IS NOT NULL AND LOWER(raw_json::jsonb->>'shopify_attributes') ~* '("_?cart_upsell"|"_?upsell_item"|"_?has_upsell"|"cart_upsell")')
)`;

export const HIGH_RISK_SQL = `(
  LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')
  OR LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_prediction', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')
  OR LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'rto_risk_level', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')
  OR LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'buyer_risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')
  OR LOWER(REPLACE(REPLACE(COALESCE(raw_json::jsonb->>'risk', ''), '_', ' '), '-', ' ')) IN ('high', 'very high')
  OR ${HIGH_RISK_TAG_SQL}
)`;
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

export function isCartUpsellOrder(raw: Record<string, unknown> | null | undefined, customTag?: string): boolean {
  if (!raw) return false;
  if (["true", "1", "yes"].includes(String(raw.cart_upsell ?? "").trim().toLowerCase())) {
    return true;
  }
  const tags = extractOrderTags(raw).map(normalized);
  const customNormalized = customTag ? normalized(customTag) : "";
  for (const tag of tags) {
    if (CART_UPSELL_TAGS.includes(tag)) return true;
    if (customNormalized && tag === customNormalized) return true;
    if (tag.includes("upsell")) return true;
  }
  const attrs = Array.isArray(raw.shopify_attributes)
    ? raw.shopify_attributes
    : Array.isArray(raw.note_attributes)
      ? raw.note_attributes
      : [];
  for (const attr of attrs) {
    if (attr && typeof attr === "object") {
      const k = normalized((attr as Record<string, unknown>).key ?? (attr as Record<string, unknown>).name);
      const v = normalized((attr as Record<string, unknown>).value);
      if (
        (k.includes("upsell") || (customNormalized && k === customNormalized)) &&
        !["false", "0", "no", ""].includes(v)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function extractOrderTags(raw: Record<string, unknown>) {
  const others = raw.others && typeof raw.others === "object" ? (raw.others as Record<string, unknown>) : {};
  const values = [
    raw.shopify_tags,
    raw.order_tag,
    raw.order_tags,
    raw.sr_tags,
    raw.tags,
    raw.international_order_tag,
    others.tags,
    others.order_tag,
    others.sr_tags,
  ].flatMap((value) => Array.isArray(value) ? value : String(value ?? "").split(","));
  const tags = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (["true", "1", "yes"].includes(String(raw.cart_upsell ?? "").trim().toLowerCase()) && !tags.some((t) => normalized(t).includes("upsell"))) {
    tags.push("cart_upsell");
  }
  return [...new Map(tags.map((tag) => [normalized(tag), tag])).values()];
}

export function isOrderHighRisk(raw: Record<string, unknown> | null | undefined, customUpsellTag?: string): boolean {
  if (!raw) return false;
  if (isCartUpsellOrder(raw, customUpsellTag)) return true;
  const others = raw.others && typeof raw.others === "object" ? (raw.others as Record<string, unknown>) : {};
  const riskFields = [
    raw.rto_risk,
    raw.rto_prediction,
    raw.rto_risk_level,
    raw.risk,
    raw.prediction,
    raw.buyer_risk,
    others.rto_risk,
    others.rto_prediction,
    others.buyer_risk,
  ];
  for (const field of riskFields) {
    const val = normalized(field);
    if (val === "high" || val === "very high") return true;
  }

  const tags = extractOrderTags(raw).map(normalized);
  for (const tag of tags) {
    if (HIGH_RISK_TAGS.includes(tag)) return true;
    if (tag.includes("high") && (tag.includes("rto") || tag.includes("risk") || tag.includes("prediction"))) return true;
  }
  return false;
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
  const [campaignResult, orderResult, upsellTagRow] = await Promise.all([
    db.prepare("SELECT id, criteria_json AS criteriaJson, position FROM campaigns WHERE is_active=TRUE AND auto_assign=TRUE ORDER BY position, created_at").all<{ id: string; criteriaJson: string; position: number }>(),
    db.prepare(`SELECT id, payment_method AS paymentMethod, products_json AS productsJson, raw_json AS rawJson, order_date AS orderDate, status,
      confirmation_status AS confirmationStatus FROM orders WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<RoutingOrder>(),
    db.prepare("SELECT value FROM sync_state WHERE key = 'cart_upsell_tag'").first<{ value: string }>().catch(() => null),
  ]);
  const customUpsellTag = String(upsellTagRow?.value || "cart_upsell").trim();
  const now = new Date().toISOString();
  const assignments: Array<{ campaignId: string; orderId: number; position: number; createdAt: string }> = [];
  const pendingOrderIds: number[] = [];
  const highRiskOrderIds: number[] = [];
  const prepaidCleanupIds: number[] = [];

  for (const order of orderResult.results) {
    const raw = JSON.parse(order.rawJson || "{}") as Record<string, unknown>;
    const highRisk = isOrderHighRisk(raw, customUpsellTag);
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
    if (actionable(order.status) && (!order.confirmationStatus || order.confirmationStatus === "not_required")) {
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
      WHERE id IN (${placeholders}) AND (confirmation_status='not_required' OR confirmation_status='' OR confirmation_status IS NULL)
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

export async function reconcileHighRiskConfirmationOrders(db: PostgresDatabase) {
  const now = new Date().toISOString();
  // 1. Sync is_high_risk flag for any recent orders (last 30 days) that match HIGH_RISK_SQL
  await db.prepare(`
    UPDATE orders SET is_high_risk=TRUE
    WHERE is_high_risk=FALSE
      AND COALESCE(NULLIF(order_date, ''), created_at)::timestamptz >= NOW() - INTERVAL '30 days'
      AND (${HIGH_RISK_SQL})
  `).run().catch(() => null);

  // 2. Ensure all high risk COD actionable orders are pending confirmation
  await db.prepare(`
    UPDATE orders SET confirmation_status='pending', confirmation_updated_at=?
    WHERE is_high_risk=TRUE
      AND LOWER(payment_method) != 'prepaid'
      AND (confirmation_status='not_required' OR confirmation_status='' OR confirmation_status IS NULL)
      AND COALESCE(NULLIF(order_date, ''), created_at)::timestamptz >= NOW() - INTERVAL '30 days'
      AND ${ACTIONABLE_STATUS_SQL}
  `).bind(now).run().catch(() => null);

  // 3. Ensure prepaid orders are never pending confirmation
  await db.prepare(`
    UPDATE orders SET confirmation_status='not_required', confirmation_updated_at=?
    WHERE LOWER(payment_method) = 'prepaid' AND confirmation_status='pending'
  `).bind(now).run().catch(() => null);
}

