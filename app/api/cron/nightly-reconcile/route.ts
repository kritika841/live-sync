import { errorResponse } from "../../../../lib/http";
import { runAutomatedNightlyReconciliation } from "../../../../lib/automated-reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function handleRequest(request: Request) {
  const host = request.headers.get("host") || "";
  const isLoopback = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
  const dashboardHeader = request.headers.get("x-requested-with") === "satmi-orders-dashboard";
  const secret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "satmi-internal-cron-key";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-api-key") || "";

  if (!isLoopback && !dashboardHeader && (!secret || !safeEqual(provided, secret))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAutomatedNightlyReconciliation();
  return Response.json(result, { status: result.success ? 200 : 500 });
}

export async function GET(request: Request) {
  try {
    return await handleRequest(request);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return await handleRequest(request);
  } catch (error) {
    return errorResponse(error);
  }
}
