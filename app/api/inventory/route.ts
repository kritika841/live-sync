import { withRequestDatabase } from "../../../lib/database";
import { errorResponse as requestErrorResponse } from "../../../lib/http";
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
async function GETHandler(request: Request) {
  try {
    await access(request);
    return Response.json(await inventoryData());
  } catch (e) {
    return errorResponse(e);
  }
}
async function POSTHandler(request: Request) {
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

export async function GET(...args: Parameters<typeof GETHandler>) {
  try { return await withRequestDatabase(() => GETHandler(...args), 20000); }
  catch (error) { return requestErrorResponse(error); }
}

export async function POST(...args: Parameters<typeof POSTHandler>) {
  try { return await withRequestDatabase(() => POSTHandler(...args), 270000); }
  catch (error) { return requestErrorResponse(error); }
}
