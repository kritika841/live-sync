import { errorResponse } from "../../../lib/http";
import { access } from "../../../lib/operations/access";
import {
  inventoryData,
  mutateInventory,
} from "../../../lib/operations/inventory";
import { getRuntimeEnv } from "../../../lib/database";
import { syncShopifyCatalog } from "../../../lib/shopify";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    await access(request);
    return Response.json(await inventoryData());
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const u = await access(request);
    const b = await request.json();
    if (b.action === "sync_shopify")
      return Response.json(await syncShopifyCatalog(getRuntimeEnv(), u.email));
    return Response.json(await mutateInventory(b, u));
  } catch (e) {
    return errorResponse(e);
  }
}
