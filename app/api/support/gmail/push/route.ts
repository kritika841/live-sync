import { withRequestDatabase } from "../../../../../lib/database";
import { errorResponse as requestErrorResponse } from "../../../../../lib/http";
import { verifyPush, runSupport } from "../../../../../lib/operations/gmail";
import { mailbox } from "../../../../../lib/operations/support";
import { errorResponse, HttpError } from "../../../../../lib/http";
export const maxDuration = 300;
async function POSTHandler(r: Request) {
  try {
    if (
      !process.env.GMAIL_PUSH_SERVICE_ACCOUNT ||
      !process.env.GMAIL_PUSH_AUDIENCE
    )
      throw new HttpError(503, "Push is not configured");
    await verifyPush(r);
    const b = await r.json();
    const data = JSON.parse(
      Buffer.from(b.message?.data || "", "base64").toString(),
    );
    if (data.emailAddress?.toLowerCase() !== mailbox().toLowerCase())
      throw new HttpError(400, "Unexpected mailbox");
    await runSupport();
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(...args: Parameters<typeof POSTHandler>) {
  try { return await withRequestDatabase(() => POSTHandler(...args), 270000); }
  catch (error) { return requestErrorResponse(error); }
}
