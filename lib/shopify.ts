import { logActivity, setSyncState, type RuntimeEnv } from "./database";

type GraphqlResponse<T> = { data?: T; errors?: Array<{ message?: string }> };
type ShopifyVariant = {
  id: string; title: string; sku: string; barcode?: string | null; inventoryQuantity?: number;
  inventoryItem?: { id?: string; tracked?: boolean };
};
type ShopifyProduct = {
  id: string; title: string; vendor: string; status: string;
  variants: { nodes: ShopifyVariant[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } };
};

function shopifyConfig(runtime: RuntimeEnv) {
  const domain = String(runtime.SHOPIFY_SHOP_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const token = String(runtime.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
  const apiVersion = String(runtime.SHOPIFY_API_VERSION || "2026-04").trim();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) throw new Error("SHOPIFY_SHOP_DOMAIN is not configured with a valid myshopify.com domain");
  if (!token) throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN is not configured");
  return { domain, token, apiVersion };
}

async function shopifyGraphql<T>(runtime: RuntimeEnv, query: string, variables: Record<string, unknown>) {
  const config = shopifyConfig(runtime);
  const response = await fetch(`https://${config.domain}/admin/api/${config.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": config.token },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as GraphqlResponse<T> | null;
  if (!response.ok || !payload) throw new Error(`Shopify catalog request failed with status ${response.status}`);
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message || "Shopify GraphQL error").join("; "));
  if (!payload.data) throw new Error("Shopify returned no catalog data");
  return payload.data;
}

const localProductId = (variantId: string) => `shopify-${variantId.split("/").pop() || variantId}`;

export function shopifyConfigured(runtime: RuntimeEnv) {
  try { shopifyConfig(runtime); return true; } catch { return false; }
}

export async function syncShopifyCatalog(runtime: RuntimeEnv, actorEmail: string) {
  const runMarker = new Date().toISOString();
  const query = `query CatalogPage($cursor: String) {
    products(first: 50, after: $cursor, sortKey: UPDATED_AT) {
      nodes { id title vendor status variants(first: 100) {
        nodes { id title sku barcode inventoryQuantity inventoryItem { id tracked } }
        pageInfo { hasNextPage endCursor }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const variantQuery = `query VariantPage($productId: ID!, $cursor: String) {
    product(id: $productId) { variants(first: 100, after: $cursor) {
      nodes { id title sku barcode inventoryQuantity inventoryItem { id tracked } }
      pageInfo { hasNextPage endCursor }
    } }
  }`;
  let cursor: string | null = null;
  let productCount = 0;
  let variantCount = 0;

  async function storeVariants(product: ShopifyProduct, variants: ShopifyVariant[]) {
    const statements = variants.map((variant) => runtime.DB.prepare(`INSERT INTO inventory_products
      (id, shopify_product_id, shopify_variant_id, inventory_item_id, sku, title, variant_title, vendor, active, raw_json, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shopify_variant_id) DO UPDATE SET inventory_item_id=excluded.inventory_item_id,
        sku=excluded.sku, title=excluded.title, variant_title=excluded.variant_title, vendor=excluded.vendor,
        active=excluded.active, raw_json=excluded.raw_json, synced_at=excluded.synced_at`).bind(
      localProductId(variant.id), product.id, variant.id, variant.inventoryItem?.id || "", variant.sku || "",
      product.title, variant.title || "", product.vendor || "", product.status === "ACTIVE",
      JSON.stringify({ product: { id: product.id, title: product.title, vendor: product.vendor, status: product.status }, variant }), runMarker,
    ));
    if (statements.length) await runtime.DB.batch(statements);
    variantCount += variants.length;
  }

  do {
    const data: { products: { nodes: ShopifyProduct[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } } } = await shopifyGraphql(runtime, query, { cursor });
    for (const product of data.products.nodes) {
      productCount += 1;
      await storeVariants(product, product.variants.nodes);
      let variantCursor = product.variants.pageInfo.hasNextPage ? product.variants.pageInfo.endCursor || null : null;
      while (variantCursor) {
        const variantData: { product: { variants: { nodes: ShopifyVariant[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } } } | null } = await shopifyGraphql(runtime, variantQuery, { productId: product.id, cursor: variantCursor });
        if (!variantData.product) throw new Error(`Shopify product disappeared during catalog sync: ${product.id}`);
        await storeVariants(product, variantData.product.variants.nodes);
        variantCursor = variantData.product.variants.pageInfo.hasNextPage ? variantData.product.variants.pageInfo.endCursor || null : null;
      }
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor || null : null;
  } while (cursor);
  await runtime.DB.prepare("UPDATE inventory_products SET active=FALSE WHERE synced_at<>?").bind(runMarker).run();
  const completedAt = new Date().toISOString();
  await setSyncState(runtime.DB, "shopify_catalog_last_sync_at", completedAt);
  await setSyncState(runtime.DB, "shopify_catalog_last_sync_count", String(variantCount));
  await logActivity(runtime.DB, "Shopify", "catalog.synced", `Imported ${variantCount} Shopify variants`, { productCount, variantCount, actorEmail });
  return { productCount, variantCount, completedAt };
}

export type ContactOrder = {
  name: string;
  phone?: string;
  tags: string[];
  customAttributes?: Array<{ key: string; value?: string | null }>;
  shippingAddress?: { phone?: string };
  billingAddress?: { phone?: string };
  lineItems?: {
    nodes: Array<{
      title?: string;
      sku?: string;
      customAttributes?: Array<{ key: string; value?: string | null }>;
    }>;
  };
};

export function detectShopifyCartUpsell(contact: ContactOrder, customTag = "cart_upsell"): boolean {
  const norm = (val: unknown) => String(val ?? "").trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  const targetNorm = norm(customTag);

  for (const t of contact.tags || []) {
    const nt = norm(t);
    if (nt === targetNorm || nt.includes("upsell") || nt === "cart upsell") return true;
  }

  for (const attr of contact.customAttributes || []) {
    const k = norm(attr.key);
    const v = norm(attr.value);
    if ((k === targetNorm || k.includes("upsell")) && !["false", "0", "no", ""].includes(v)) {
      return true;
    }
  }

  for (const item of contact.lineItems?.nodes || []) {
    for (const attr of item.customAttributes || []) {
      const k = norm(attr.key);
      const v = norm(attr.value);
      if ((k === targetNorm || k.includes("upsell")) && !["false", "0", "no", ""].includes(v)) {
        return true;
      }
    }
  }

  return false;
}
/** Exact Shopify order-name match, with bounded batches; no customer-name matching. */
export async function shopifyOrderContacts(runtime: RuntimeEnv, names: string[]) {
  const unique = [...new Set(names.map(name => name.replace(/^#/, "")))];
  const result = new Map<string, ContactOrder>();
  for (let start=0; start<unique.length; start+=20) {
    const query = unique.slice(start,start+20).map(name => `name:${JSON.stringify("#"+name)}`).join(" OR ");
    const data = await shopifyGraphql<{orders:{nodes:ContactOrder[]}}>(
      runtime,
      `query Contacts($query:String!) {
        orders(first:100, query:$query) {
          nodes {
            name
            phone
            tags
            customAttributes { key value }
            shippingAddress { phone }
            billingAddress { phone }
            lineItems(first: 50) {
              nodes {
                title
                sku
                customAttributes { key value }
              }
            }
          }
        }
      }`,
      { query }
    );
    for (const order of data.orders.nodes) {
      const name=order.name.replace(/^#/, "");
      if(unique.includes(name)) result.set(name,order);
    }
  }
  return result;
}

export async function enrichRecentShopifyOrderTags(runtime: RuntimeEnv, orderIds: number[]) {
  if (!orderIds.length || !shopifyConfigured(runtime)) return 0;
  const uniqueIds = [...new Set(orderIds.filter(Boolean))].slice(0, 60);
  if (!uniqueIds.length) return 0;

  const [rows, upsellTagRow] = await Promise.all([
    runtime.DB.prepare(`
      SELECT id, channel_order_id AS "channelOrderId", customer_phone AS "customerPhone", raw_json AS "rawJson"
      FROM orders
      WHERE id IN (${uniqueIds.map(() => "?").join(",")})
        AND LOWER(channel_name) LIKE '%shopify%'
        AND (raw_json::jsonb->'shopify_tags' IS NULL OR raw_json::jsonb->'shopify_attributes' IS NULL)
    `).bind(...uniqueIds).all<{ id: number; channelOrderId: string; customerPhone: string; rawJson: string }>(),
    runtime.DB.prepare("SELECT value FROM sync_state WHERE key = 'cart_upsell_tag'").first<{ value: string }>().catch(() => null),
  ]);

  if (!rows.results.length) return 0;
  const customUpsellTag = String(upsellTagRow?.value || "cart_upsell").trim();
  const contacts = await shopifyOrderContacts(runtime, rows.results.map((r) => r.channelOrderId));
  const { completePhone } = await import("./contact");
  const { isOrderHighRisk, routeConfirmationOrders } = await import("./confirmation");

  const touchedIds: number[] = [];
  const statements = rows.results.flatMap((row) => {
    const contact = contacts.get(row.channelOrderId.replace(/^#/, ""));
    if (!contact) return [];
    const phone = completePhone(contact.shippingAddress?.phone, contact.phone, contact.billingAddress?.phone, row.customerPhone);
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(row.rawJson || "{}");
    } catch {
      raw = {};
    }
    const isCartUpsell = detectShopifyCartUpsell(contact, customUpsellTag);
    const mergedTags = isCartUpsell && !contact.tags.includes(customUpsellTag)
      ? [...contact.tags, customUpsellTag]
      : contact.tags;
    const attrs = contact.customAttributes || [];
    const mergedRaw = {
      ...raw,
      shopify_tags: mergedTags,
      shopify_attributes: attrs,
      ...(isCartUpsell ? { cart_upsell: true } : {}),
    };
    const highRisk = isOrderHighRisk(mergedRaw, customUpsellTag);
    touchedIds.push(row.id);
    return [
      runtime.DB.prepare(`
        UPDATE orders
        SET customer_phone = CASE WHEN ? <> '' THEN ? ELSE customer_phone END,
            raw_json = (raw_json::jsonb || jsonb_build_object(
              'shopify_tags', ?::jsonb,
              'shopify_attributes', ?::jsonb,
              'cart_upsell', ?::jsonb
            ))::text,
            is_high_risk = (is_high_risk OR ?)
        WHERE id = ?
      `).bind(
        phone || "",
        phone || "",
        JSON.stringify(mergedTags),
        JSON.stringify(attrs),
        JSON.stringify(isCartUpsell),
        highRisk,
        row.id
      ),
    ];
  });

  if (statements.length) {
    await runtime.DB.batch(statements);
    await routeConfirmationOrders(runtime.DB, touchedIds).catch(() => null);
  }
  return statements.length;
}
