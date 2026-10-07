import { NextResponse } from "next/server";
import { authenticateUser, createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "../../../../lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      email?: string;
      password?: string;
    } | null;

    if (!body || !body.email || !body.password) {
      return NextResponse.json(
        { ok: false, error: "Email and password are required." },
        { status: 400 }
      );
    }

    const { user, error } = await authenticateUser(body.email, body.password);
    if (!user || error) {
      return NextResponse.json(
        { ok: false, error: error || "The email or password is incorrect." },
        { status: 401 }
      );
    }

    const token = await createSessionToken(user);
    const response = NextResponse.json({ ok: true, user });

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("Sign-in endpoint error:", err);
    return NextResponse.json(
      { ok: false, error: "Sign-in is temporarily unavailable. Please try again." },
      { status: 500 }
    );
  }
}
