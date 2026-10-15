import { requireApiUser } from "../../../lib/auth/access";
import { getRuntimeEnv } from "../../../lib/database";
import { cachedValue, invalidateCache } from "../../../lib/server-cache";
import { errorResponse } from "../../../lib/http";
import {
  getLiveShopifyProductsFromDb,
  syncShopifyProductsToDb,
} from "../../../lib/shopify-products-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const access = await requireApiUser();
    if (access.response) return access.response;

    const runtime = getRuntimeEnv();
    const url = new URL(request.url);

    // Optional manual sync trigger: /api/products?sync=true
    if (url.searchParams.get("sync") === "true") {
      const syncResult = await syncShopifyProductsToDb(runtime);
      invalidateCache("live-shopify-products-v2");
      return Response.json({
        products: syncResult.products,
        total: syncResult.total,
        syncedAt: syncResult.syncedAt,
        synced: true,
      });
    }

    const data = await cachedValue(
      "live-shopify-products-v2",
      300000, // 5 minutes process cache
      async () => {
        let products = await getLiveShopifyProductsFromDb(runtime.DB);

        // If database table is empty, run auto-sync once to populate it
        if (!products || products.length === 0) {
          const syncResult = await syncShopifyProductsToDb(runtime);
          products = syncResult.products;
        }

        return {
          products,
          total: products.length,
          fetchedAt: new Date().toISOString(),
        };
      }
    );

    return Response.json(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  try {
    const access = await requireApiUser();
    if (access.response) return access.response;

    const runtime = getRuntimeEnv();
    const syncResult = await syncShopifyProductsToDb(runtime);
    invalidateCache("live-shopify-products-v2");

    return Response.json({
      success: true,
      products: syncResult.products,
      total: syncResult.total,
      syncedAt: syncResult.syncedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
