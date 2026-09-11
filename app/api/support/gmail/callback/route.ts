import { after } from "next/server";
import { syncMailbox } from "../../../../../lib/operations/gmail";
import { cookies } from "next/headers";
import { access } from "../../../../../lib/operations/access";
import { isAdmin } from "../../../../../lib/auth/access";
import { operationsDb } from "../../../../../lib/operations/schema";
import { mailbox } from "../../../../../lib/operations/support";
import {
  tokenRequest,
  gmail,
  encrypt,
} from "../../../../../lib/operations/gmail";
import { errorResponse, HttpError } from "../../../../../lib/http";
export const maxDuration=300;
export async function GET(r: Request) {
  try {
    const u = await access(r, "support");
    if (!isAdmin(u)) throw new HttpError(403, "Administrator access required");
    const url = new URL(r.url),
      c = await cookies();
    const saved = c.get("gmail_oauth")?.value;
    c.set("gmail_oauth", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/support/gmail",
      maxAge: 0,
    });
    if (!saved)
      throw new HttpError(400, "Connection request expired. Start again.");
    const state = JSON.parse(saved);
    if (url.searchParams.get("state") !== state.state || state.user !== u.id)
      throw new HttpError(400, "Invalid connection state");
    const code = url.searchParams.get("code");
    if (!code) throw new HttpError(400, "Google authorization was cancelled");
    const token = await tokenRequest({
      code,
      grant_type: "authorization_code",
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      code_verifier: state.verifier,
    });
    const profile = await gmail("profile", token.access_token);
    if (profile.emailAddress.toLowerCase() !== mailbox().toLowerCase())
      throw new HttpError(400, `Connect ${mailbox()} to this dashboard`);
    if (!token.refresh_token)
      throw new HttpError(
        400,
        "Google did not grant offline access. Reconnect and grant the requested permissions.",
      );
    const db = await operationsDb();
    const since = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "/");
    await db
      .prepare(
        `INSERT INTO support_mailboxes(email,encrypted_refresh_token,connected_by,import_since) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET encrypted_refresh_token=EXCLUDED.encrypted_refresh_token,connected_by=EXCLUDED.connected_by,last_error=''`,
      )
      .bind(mailbox(), encrypt(token.refresh_token), u.id, since)
      .run();
    after(async()=>{try{await syncMailbox();}catch{console.error("Initial Gmail import failed; scheduled retry will follow");}});
    return Response.redirect(new URL("/?view=support&connected=1", r.url));
  } catch (e) {
    return errorResponse(e);
  }
}
