import { getChatGPTUser } from "../../chatgpt-auth";
import { getRuntimeEnv } from "../../../lib/database";
import { syncShiprocketOrders } from "../../../lib/shiprocket";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && !(await getChatGPTUser())) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { mode?: string };
  const mode = body.mode === "full" ? "full" : "incremental";
  try {
    const result = await syncShiprocketOrders(getRuntimeEnv(), mode);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 502 });
  }
}
