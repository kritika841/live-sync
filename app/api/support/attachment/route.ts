import { access } from "../../../../lib/operations/access";
import { ticketAccess } from "../../../../lib/operations/support";
import { operationsDb } from "../../../../lib/operations/schema";
import { gmailAttachment } from "../../../../lib/operations/gmail";
import { errorResponse, HttpError } from "../../../../lib/http";
export async function GET(r: Request) {
  try {
    const u = await access(r, "support"),
      url = new URL(r.url),
      db = await operationsDb();
    const m = await db.transaction(async (sql) => {
      const [row] =
        await sql`SELECT * FROM support_messages WHERE id=${url.searchParams.get("message") || ""}`;
      if (!row) throw new HttpError(404, "Message not found");
      await ticketAccess(sql, row.ticket_id, u);
      return row;
    });
    const attachment = m.attachments.find(
      (a: { attachmentId: string }) =>
        a.attachmentId === url.searchParams.get("attachment"),
    );
    if (!attachment) throw new HttpError(404, "Attachment not found");
    if (attachment.size > 10 * 1024 * 1024)
      throw new HttpError(
        400,
        "Attachment exceeds the 10 MB download limit. Open it in Gmail.",
      );
    const data = await gmailAttachment(
      m.gmail_message_id,
      attachment.attachmentId,
    );
    return new Response(Buffer.from(data.data, "base64url"), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
