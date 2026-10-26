import crypto from "crypto";
import { errorResponse } from "../../../../lib/http";
import { ensureSchema, getRuntimeEnv, logActivity } from "../../../../lib/database";
import { isOrderHighRisk, routeConfirmationOrders } from "../../../../lib/confirmation";
import { invalidateCache } from "../../../../lib/server-cache";

export const dynamic = "force-dynamic";

function verifyShopifyHmac(rawBody: string, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const generated = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  if (generated.length !== hmacHeader.length) return false;
  return crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(hmacHeader));
}

function normalizeStr(val: unknown): string {
  return String(val ?? "").trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
}

function extractPayloadCartUpsell(payload: Record<string, unknown>, customTag = "cart_upsell"): {
  isUpsell: boolean;
  tags: string[];
  attributes: Array<{ key: string; value: string }>;
} {
  const targetNorm = normalizeStr(customTag);
  const rawTags = Array.isArray(payload.tags)
    ? payload.tags.map(String)
    : String(payload.tags || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

  let isUpsell = Boolean(payload.cart_upsell === true || payload.cart_upsell === "true");

  for (const t of rawTags) {
    const nt = normalizeStr(t);
    if (nt === targetNorm || nt.includes("upsell") || nt === "cart upsell") {
      isUpsell = true;
    }
  }

  const attributes: Array<{ key: string; value: string }> = [];
  const rawNoteAttrs = Array.isArray(payload.note_attributes)
    ? payload.note_attributes
    : Array.isArray(payload.customAttributes)
      ? payload.customAttributes
      : [];

  for (const item of rawNoteAttrs) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const key = String(rec.name ?? rec.key ?? "").trim();
      const value = String(rec.value ?? "").trim();
      if (key) {
        attributes.push({ key, value });
        const nk = normalizeStr(key);
        const nv = normalizeStr(value);
        if ((nk === targetNorm || nk.includes("upsell")) && !["false", "0", "no", ""].includes(nv)) {
          isUpsell = true;
        }
      }
    }
  }

  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  for (const li of lineItems) {
    if (li && typeof li === "object") {
      const props = Array.isArray((li as Record<string, unknown>).properties)
        ? ((li as Record<string, unknown>).properties as Array<Record<string, unknown>>)
        : [];
      for (const prop of props) {
        if (prop && typeof prop === "object") {
          const pk = normalizeStr(prop.name ?? prop.key);
          const pv = normalizeStr(prop.value);
          if ((pk === targetNorm || pk.includes("upsell")) && !["false", "0", "no", ""].includes(pv)) {
            isUpsell = true;
            attributes.push({ key: String(prop.name ?? prop.key), value: String(prop.value ?? "true") });
          }
        }
      }
    }
  }

  if (isUpsell && !rawTags.some((t) => normalizeStr(t) === targetNorm)) {
    rawTags.push(customTag);
  }

  return { isUpsell, tags: rawTags, attributes };
}

async function handlePOST(request: Request) {
  const runtime = getRuntimeEnv();
  const rawText = await request.text().catch(() => "");
  if (!rawText) return Response.json({ error: "Empty payload" }, { status: 400 });

  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const shopifyHmac = request.headers.get("x-shopify-hmac-sha256") || "";
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || runtime.SHIPROCKET_WEBHOOK_SECRET || "";
  const url = new URL(request.url);
  const providedToken =
    request.headers.get("x-webhook-token") ||
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("token") ||
    url.searchParams.get("secret") ||
    (typeof payload.secret === "string" ? payload.secret : "") ||
    "";

  // Verify either Shopify HMAC or token if a secret is configured
  if (webhookSecret) {
    const hmacValid = shopifyHmac ? verifyShopifyHmac(rawText, shopifyHmac, webhookSecret) : false;
    const tokenValid = providedToken.trim() === webhookSecret.trim();
    if (!hmacValid && !tokenValid && (shopifyHmac || providedToken)) {
      return Response.json({ error: "Unauthorized webhook signature or token" }, { status: 401 });
    }
  }

  await ensureSchema(runtime.DB);

  const upsellTagRow = await runtime.DB.prepare("SELECT value FROM sync_state WHERE key = 'cart_upsell_tag'")
    .first<{ value: string }>()
    .catch(() => null);
  const customUpsellTag = String(upsellTagRow?.value || "cart_upsell").trim() || "cart_upsell";

  const rawName = String(payload.name || payload.order_number || payload.channel_order_id || "").trim();
  const cleanOrderName = rawName.replace(/^#+/, "");
  if (!cleanOrderName) {
    return Response.json({ error: "Order name or number is required" }, { status: 400 });
  }

  const { isUpsell, tags, attributes } = extractPayloadCartUpsell(payload, customUpsellTag);

  const existing = await runtime.DB.prepare(`
    SELECT id, channel_order_id AS "channelOrderId", raw_json AS "rawJson", payment_method AS "paymentMethod"
    FROM orders
    WHERE REPLACE(channel_order_id, '#', '') = ?
    ORDER BY id DESC LIMIT 5
  `).bind(cleanOrderName).all<{ id: number; channelOrderId: string; rawJson: string; paymentMethod: string }>();

  const touchedIds: number[] = [];
  for (const row of existing.results) {
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(row.rawJson || "{}");
    } catch {
      raw = {};
    }
    const existingTags = Array.isArray(raw.shopify_tags) ? (raw.shopify_tags as string[]) : [];
    const mergedTags = [...new Set([...existingTags, ...tags])];
    const mergedRaw = {
      ...raw,
      shopify_tags: mergedTags,
      shopify_attributes: attributes,
      ...(isUpsell ? { cart_upsell: true } : {}),
    };
    const highRisk = isOrderHighRisk(mergedRaw, customUpsellTag);
    await runtime.DB.prepare(`
      UPDATE orders
      SET raw_json = (raw_json::jsonb || jsonb_build_object(
            'shopify_tags', ?::jsonb,
            'shopify_attributes', ?::jsonb,
            'cart_upsell', ?::jsonb
          ))::text,
          is_high_risk = (is_high_risk OR ?)
      WHERE id = ?
    `).bind(
      JSON.stringify(mergedTags),
      JSON.stringify(attributes),
      JSON.stringify(isUpsell),
      highRisk,
      row.id
    ).run();
    touchedIds.push(row.id);
  }

  if (touchedIds.length > 0) {
    await routeConfirmationOrders(runtime.DB, touchedIds).catch(() => null);
    invalidateCache();
  }

  await logActivity(
    runtime.DB,
    "Shopify webhook",
    isUpsell ? "order.cart_upsell_detected" : "order.shopify_webhook",
    isUpsell
      ? `Shopify cart upsell order #${cleanOrderName} flagged for confirmation (${touchedIds.length ? "matched in DB" : "queued for next Shiprocket sync"})`
      : `Shopify order webhook received for #${cleanOrderName}`,
    {
      orderName: cleanOrderName,
      isUpsell,
      tags,
      attributes,
      matchedOrderIds: touchedIds,
    }
  ).catch(() => null);

  return Response.json({
    ok: true,
    orderName: cleanOrderName,
    isCartUpsell: isUpsell,
    matchedOrders: touchedIds.length,
  });
}

async function handleGET() {
  return Response.json({
    ok: true,
    endpoint: "Shopify Order & Custom Cart Upsell Webhook",
    supportedTriggers: ["orders/create", "orders/updated", "custom_cart_upsell"],
  });
}

export async function POST(request: Request) {
  try {
    return await handlePOST(request);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    return await handleGET();
  } catch (error) {
    return errorResponse(error);
  }
}
