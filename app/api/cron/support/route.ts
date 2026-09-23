import { withRequestDatabase } from "../../../../lib/database";
import { errorResponse as requestErrorResponse } from "../../../../lib/http";
import { timingSafeEqual } from "node:crypto";
import { runSupport } from "../../../../lib/operations/gmail";
import { errorResponse } from "../../../../lib/http";
export const maxDuration = 300;
async function GETHandler(r: Request) {
  const actual = Buffer.from(r.headers.get("authorization") || ""),
    expected = Buffer.from("Bearer " + (process.env.CRON_SECRET || ""));
  if (
    !process.env.CRON_SECRET ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runSupport());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(...args: Parameters<typeof GETHandler>) {
  try { return await withRequestDatabase(() => GETHandler(...args), 270000); }
  catch (error) { return requestErrorResponse(error); }
}
