import { timingSafeEqual } from "node:crypto";
import { runSupport } from "../../../../lib/operations/gmail";
import { errorResponse } from "../../../../lib/http";
export const maxDuration = 300;
export async function GET(r: Request) {
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
