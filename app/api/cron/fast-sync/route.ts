import { getRuntimeEnv } from "../../../../lib/database";
import { syncRecentOrders } from "../../../../lib/shiprocket";
import { errorResponse } from "../../../../lib/http";
import { invalidateCache } from "../../../../lib/server-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const host = request.headers.get("host") || "";
  const isLoopback = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
  const dashboardHeader = request.headers.get("x-requested-with") === "satmi-orders-dashboard";
  if (isLoopback || dashboardHeader) return true;

  const expectedSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "satmi-internal-cron-key";
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-api-key") || "";
  if (expectedSecret && received && received === expectedSecret) return true;

  return false;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const runtime = getRuntimeEnv();
    const result = await syncRecentOrders(runtime);
    invalidateCache();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
