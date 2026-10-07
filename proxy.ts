import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "./lib/auth/session";

export default async function proxy(request: NextRequest) {
  // 1. Check local session cookie first
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) {
    const user = await verifySessionToken(sessionCookie);
    if (user) {
      return NextResponse.next({ request });
    }
  }

  // 2. Allow bypass in local development
  if (process.env.NODE_ENV === "development") {
    return NextResponse.next({ request });
  }

  // 3. Fallback to Supabase SSR if legacy session cookies exist
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    const hasAuthCookie = request.cookies.getAll().some(
      (c) => c.name.includes("-auth-token") || c.name.startsWith("sb-")
    );
    if (hasAuthCookie) {
      try {
        const { createServerClient } = await import("@supabase/ssr");
        let response = NextResponse.next({ request });
        const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          {
            cookies: {
              getAll: () => request.cookies.getAll(),
              setAll(values) {
                values.forEach(({ name, value }) => request.cookies.set(name, value));
                response = NextResponse.next({ request });
                values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
              },
            },
          }
        );
        const { data: { user } } = await supabase.auth.getUser();
        if (user) return response;
      } catch {
        // Fall through to redirect if Supabase is unreachable
      }
    }
  }

  return NextResponse.redirect(new URL("/auth/sign-in", request.url));
}

export const config = {
  matcher: ["/", "/admin/:path*"],
};
