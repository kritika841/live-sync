import { errorResponse } from "../../../lib/http";
import { getRuntimeEnv } from "../../../lib/database";
import { syncShiprocketOrders } from "../../../lib/shiprocket";
import { requireApiUser, isAdmin, isSameOrigin } from "../../../lib/auth/access";
import { invalidateCache } from "../../../lib/server-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function isSameOriginDashboardRequest(request: Request) {
  if (request.headers.get("x-requested-with") === "satmi-orders-dashboard") return true;
  return isSameOrigin(request);
}

async function handlePOST(request: Request) {
  const runtime = getRuntimeEnv();
  const provided = request.headers.get("x-api-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const secretAccess = safeEqual(provided, runtime.SHIPROCKET_WEBHOOK_SECRET || "");
  if (!secretAccess) {
    const access = await requireApiUser();
    if (access.response) return access.response;
    if (!isAdmin(access.user) && access.user.role !== "operations") return Response.json({ error: "Operations access required" }, { status: 403 });
    if (!isSameOriginDashboardRequest(request)) {
      return Response.json({ error: "Invalid request origin" }, { status: 403 });
    }
  }
  const body = await request.json().catch(() => ({})) as { mode?: string; page?: number };
  const mode = body.mode === "full" ? "full" : "incremental";
  try {
    const result = await syncShiprocketOrders(runtime, mode, "manual sync", {
      startPage: Number.isFinite(Number(body.page)) ? Math.max(1, Number(body.page)) : undefined,
      maxPages: mode === "full" ? 30 : 15,
    });
    invalidateCache();
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(...args: Parameters<typeof handlePOST>) { try { return await handlePOST(...args); } catch (error) { return errorResponse(error); } }
