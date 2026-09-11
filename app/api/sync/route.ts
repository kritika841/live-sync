import { errorResponse } from "../../../lib/http";
import { getRuntimeEnv } from "../../../lib/database";
import { syncShiprocketOrders } from "../../../lib/shiprocket";
import { requireApiUser, isAdmin } from "../../../lib/auth/access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function isSameOriginDashboardRequest(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || (process.env.NODE_ENV === "production" ? "https" : "http");
  return request.headers.get("x-requested-with") === "satmi-orders-dashboard"
    && request.headers.get("sec-fetch-site") === "same-origin"
    && Boolean(origin && host && origin === `${protocol}://${host}`);
}

async function handlePOST(request: Request) {
  const runtime = getRuntimeEnv();
  const provided = request.headers.get("x-api-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const secretAccess = safeEqual(provided, runtime.SHIPROCKET_WEBHOOK_SECRET || "");
  if (!secretAccess) {
    const access = await requireApiUser();
    if (access.response) return access.response;
    if(!isAdmin(access.user) && access.user.role!=="operations")return Response.json({error:"Operations access required"},{status:403});
  }
  if (!secretAccess && !isSameOriginDashboardRequest(request)) {
    return Response.json({ error: "A valid sync API key is required" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { mode?: string; page?: number };
  const mode = body.mode === "full" ? "full" : "incremental";
  try {
    const result = await syncShiprocketOrders(runtime, mode, "manual sync", {
      startPage: Number.isFinite(Number(body.page)) ? Math.max(1, Number(body.page)) : undefined,
      maxPages: 4,
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(...args: Parameters<typeof handlePOST>) { try { return await handlePOST(...args); } catch (error) { return errorResponse(error); } }
