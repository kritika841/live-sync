import { getRuntimeEnv } from "../../../../lib/database";
import { syncShiprocketOrders } from "../../../../lib/shiprocket";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!safeEqual(provided, secret)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncShiprocketOrders(getRuntimeEnv(), "incremental", "twice-daily verification");
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Scheduled sync failed" }, { status: 502 });
  }
}
