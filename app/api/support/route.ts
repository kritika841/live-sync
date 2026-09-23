import { withRequestDatabase } from "../../../lib/database";
import { errorResponse as requestErrorResponse } from "../../../lib/http";
import { access, manager } from "../../../lib/operations/access";
import {
  supportData,
  mutateSupport,
  refreshAgents,
} from "../../../lib/operations/support";
import { syncMailbox, flushOutbox } from "../../../lib/operations/gmail";
import { HttpError, errorResponse } from "../../../lib/http";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function GETHandler(r: Request) {
  try {
    const u = await access(r, "support");
    return Response.json(
      await supportData(
        u,
        new URL(r.url).searchParams.get("ticket") || undefined,
        {
          page: Number(new URL(r.url).searchParams.get("page") || 1),
          queue: new URL(r.url).searchParams.get("queue") || "all",
          search: new URL(r.url).searchParams.get("q") || "",
        },
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
async function POSTHandler(r: Request) {
  try {
    const u = await access(r, "support");
    const b = await r.json();
    if (b.action === "sync" || b.action === "team") {
      if (!manager(u)) throw new HttpError(403, "Manager access required");
      await refreshAgents();
      if (b.action === "sync") {
        const result = await syncMailbox();
        await flushOutbox();
        return Response.json(result);
      }
      return Response.json({ ok: true });
    }
    const result = await mutateSupport(b, u);
    if (b.action === "reply" || b.action === "retry") {
      try {
        await flushOutbox();
      } catch {
        return Response.json({
          ...result,
          notice:
            "Reply saved in the outbox. Connect Gmail or retry synchronization to send it.",
        });
      }
    }
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(...args: Parameters<typeof GETHandler>) {
  try { return await withRequestDatabase(() => GETHandler(...args), 20000); }
  catch (error) { return requestErrorResponse(error); }
}

export async function POST(...args: Parameters<typeof POSTHandler>) {
  try { return await withRequestDatabase(() => POSTHandler(...args), 270000); }
  catch (error) { return requestErrorResponse(error); }
}
