import type { PostgresDatabase, RuntimeEnv } from "./database";
import fs from "node:fs/promises";
import path from "node:path";

export interface ShopifyLiveProductRow {
  id: string;
  title: string;
  vendor: string;
  status: string;
  is_live: boolean;
  variants_count: number;
  total_inventory: number;
  skus: string;
  raw_json: string;
  synced_at: string;
}

export async function ensureShopifyLiveProductsSchema(db: PostgresDatabase) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS shopify_live_products (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      is_live BOOLEAN NOT NULL DEFAULT TRUE,
      variants_count INTEGER NOT NULL DEFAULT 1,
      total_inventory INTEGER NOT NULL DEFAULT 0,
      skus TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at TEXT NOT NULL
    )
  `).run().catch(() => null);

  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_shopify_live_products_live_title ON shopify_live_products (is_live, title)"
  ).run().catch(() => null);

  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_shopify_live_products_title ON shopify_live_products (title)"
  ).run().catch(() => null);
}

/**
 * Fast sub-millisecond retrieval of all live Shopify products directly from the database.
 */
export async function getLiveShopifyProductsFromDb(db: PostgresDatabase): Promise<string[]> {
  try {
    // 1. Instant lookup from sync_state precomputed cache (1 query, ~2ms)
    const stateRow = await db
      .prepare("SELECT value FROM sync_state WHERE key = ?")
      .bind("shopify_live_products_json")
      .first<{ value: string }>()
      .catch(() => null);

    if (stateRow?.value) {
      try {
        const parsed = JSON.parse(stateRow.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch {
        // fallback
      }
    }

    // 2. Query shopify_live_products table
    const liveRows = await db
      .prepare("SELECT DISTINCT title FROM shopify_live_products WHERE is_live = TRUE ORDER BY title")
      .all<{ title: string }>()
      .catch(() => ({ results: [] }));

    if (liveRows.results && liveRows.results.length > 0) {
      const titles = liveRows.results.map((r) => r.title.trim()).filter(Boolean);
      // Cache back into sync_state for instant future lookups
      const now = new Date().toISOString();
      await db
        .prepare("INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at")
        .bind("shopify_live_products_json", JSON.stringify(titles), now)
        .run()
        .catch(() => null);
      return titles;
    }

    // 3. Fallback to inventory_products table
    const invRows = await db
      .prepare("SELECT DISTINCT title FROM inventory_products WHERE active = TRUE ORDER BY title")
      .all<{ title: string }>()
      .catch(() => ({ results: [] }));

    if (invRows.results && invRows.results.length > 0) {
      return invRows.results.map((r) => r.title.trim()).filter(Boolean);
    }
  } catch (err) {
    console.warn("Error getting live Shopify products from DB:", err);
  }

  return [];
}

/**
 * Syncs all live products into the database (shopify_live_products and sync_state).
 */
export async function syncShopifyProductsToDb(
  runtime: RuntimeEnv,
  catalogProducts?: Array<{
    id: string;
    title: string;
    vendor?: string;
    status: string;
    variants?: {
      nodes: Array<{ id: string; title?: string; sku?: string | null; inventoryQuantity?: number }>;
    };
  }>
): Promise<{ products: string[]; total: number; syncedAt: string }> {
  const db = runtime.DB;
  await ensureShopifyLiveProductsSchema(db);
  const now = new Date().toISOString();

  let productsToSync = catalogProducts;

  // If not passed in, load from .local/shopify-products.json
  if (!productsToSync || productsToSync.length === 0) {
    try {
      const raw = await fs.readFile(path.resolve(process.cwd(), ".local/shopify-products.json"), "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.products) && parsed.products.length > 0) {
        productsToSync = parsed.products;
      }
    } catch {
      // Local cache not found, will fetch from Shopify if credentials present
    }
  }

  // If still not available and credentials configured, fetch live from Shopify Admin API
  if ((!productsToSync || productsToSync.length === 0) && runtime.SHOPIFY_SHOP_DOMAIN && runtime.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    try {
      const domain = String(runtime.SHOPIFY_SHOP_DOMAIN).replace(/^https?:\/\//, "").replace(/\/$/, "");
      const version = runtime.SHOPIFY_API_VERSION || "2026-04";
      const fetched: Array<any> = [];
      let cursor: string | null = null;
      let hasNext = true;

      while (hasNext) {
        const res: globalThis.Response = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": runtime.SHOPIFY_ADMIN_ACCESS_TOKEN!,
          },
          body: JSON.stringify({
            query: `query($cursor: String) {
              products(first: 50, after: $cursor) {
                nodes {
                  id
                  title
                  vendor
                  status
                  variants(first: 100) {
                    nodes {
                      id
                      title
                      sku
                      inventoryQuantity
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }`,
            variables: { cursor },
          }),
        });

        const json: any = await res.json();
        const nodes = json.data?.products?.nodes || [];
        fetched.push(...nodes);
        hasNext = Boolean(json.data?.products?.pageInfo?.hasNextPage);
        cursor = json.data?.products?.pageInfo?.endCursor || null;
      }

      if (fetched.length > 0) {
        productsToSync = fetched;
      }
    } catch (err) {
      console.warn("Failed to fetch live products from Shopify API:", err);
    }
  }

  if (!productsToSync || productsToSync.length === 0) {
    const existing = await getLiveShopifyProductsFromDb(db);
    return { products: existing, total: existing.length, syncedAt: now };
  }

  const activeTitlesSet = new Set<string>();
  const rows: unknown[][] = [];

  for (const p of productsToSync) {
    const isLive = p.status === "ACTIVE";
    if (isLive && p.title?.trim()) {
      activeTitlesSet.add(p.title.trim());
    }

    const variants = p.variants?.nodes || [];
    const totalInventory = variants.reduce((sum, v) => sum + (v.inventoryQuantity || 0), 0);
    const skus = variants.map((v) => v.sku).filter(Boolean).join(", ");

    rows.push([
      p.id,
      p.title.trim(),
      p.vendor || "",
      p.status,
      isLive,
      variants.length,
      totalInventory,
      skus,
      JSON.stringify(p),
      now,
    ]);
  }

  // Multi-row INSERT in batches of 25 for fast network transmission
  const BATCH_SIZE = 25;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const flattened = chunk.flat();

    await db.prepare(`
      INSERT INTO shopify_live_products (
        id, title, vendor, status, is_live, variants_count, total_inventory, skus, raw_json, synced_at
      ) VALUES ${placeholders}
      ON CONFLICT(id) DO UPDATE SET
        title = EXCLUDED.title,
        vendor = EXCLUDED.vendor,
        status = EXCLUDED.status,
        is_live = EXCLUDED.is_live,
        variants_count = EXCLUDED.variants_count,
        total_inventory = EXCLUDED.total_inventory,
        skus = EXCLUDED.skus,
        raw_json = EXCLUDED.raw_json,
        synced_at = EXCLUDED.synced_at
    `).bind(...flattened).run().catch((err) => {
      console.warn("Error inserting chunk into shopify_live_products:", err);
    });
  }

  const sortedLiveTitles = Array.from(activeTitlesSet).sort((a, b) => a.localeCompare(b));

  // Save to sync_state for instant sub-millisecond retrieval
  await db
    .prepare("INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at")
    .bind("shopify_live_products_json", JSON.stringify(sortedLiveTitles), now)
    .run();

  await db
    .prepare("INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at")
    .bind("shopify_live_products_count", String(sortedLiveTitles.length), now)
    .run();

  await db
    .prepare("INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at")
    .bind("shopify_live_products_synced_at", now, now)
    .run();

  return {
    products: sortedLiveTitles,
    total: sortedLiveTitles.length,
    syncedAt: now,
  };
}
