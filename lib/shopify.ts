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
