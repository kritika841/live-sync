import { cookies } from "next/headers";
import { randomBytes, createHash } from "node:crypto";
import { access } from "../../../../../lib/operations/access";
import { isAdmin } from "../../../../../lib/auth/access";
import { errorResponse, HttpError } from "../../../../../lib/http";
import { mailbox } from "../../../../../lib/operations/support";
export async function GET(r: Request) {
  try {
    const u = await access(r, "support");
    if (!isAdmin(u)) throw new HttpError(403, "Administrator access required");
    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET ||
      !process.env.GOOGLE_REDIRECT_URI ||
      !process.env.SUPPORT_TOKEN_KEY
    )
      throw new HttpError(
        503,
        "Configure Google OAuth client, redirect URI, and encryption key first",
      );
    const state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url");
    const c = await cookies();
    c.set("gmail_oauth", JSON.stringify({ state, verifier, user: u.id }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/api/support/gmail",
    });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope:
        "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
      access_type: "offline",
      prompt: "consent",
      state,
      login_hint: mailbox(),
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    return Response.redirect(
      "https://accounts.google.com/o/oauth2/v2/auth?" + params,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
