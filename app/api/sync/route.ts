import { getRuntimeEnv } from "../../../lib/database";
import { syncShiprocketOrders } from "../../../lib/shiprocket";

export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const provided = request.headers.get("x-api-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const secretAccess = safeEqual(provided, runtime.SHIPROCKET_WEBHOOK_SECRET || "");
  if (!secretAccess) {
    return Response.json({ error: "A valid sync API key is required" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { mode?: string };
  const mode = body.mode === "full" ? "full" : "incremental";
  try {
    const result = await syncShiprocketOrders(runtime, mode, "manual sync");
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 502 });
  }
}
