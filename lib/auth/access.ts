import { HttpError } from "../http";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../supabase/server";

export type DashboardUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

function roleOf(user: { role?: unknown }) {
  return typeof user.role === "string" && user.role ? user.role : "user";
}

function dashboardUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }): DashboardUser {
  return {
    id: user.id,
    email: user.email || "",
    name: typeof user.user_metadata?.name === "string" && user.user_metadata.name ? user.user_metadata.name : user.email || "User",
    role: roleOf({ role: user.app_metadata?.role }),
  };
}

function userFromClaims(claims: Record<string, unknown>): DashboardUser | null {
  const id = typeof claims.sub === "string" ? claims.sub : "";
  if (!id) return null;
  const userMetadata = claims.user_metadata && typeof claims.user_metadata === "object" ? claims.user_metadata as Record<string, unknown> : {};
  const appMetadata = claims.app_metadata && typeof claims.app_metadata === "object" ? claims.app_metadata as Record<string, unknown> : {};
  return dashboardUser({
    id,
    email: typeof claims.email === "string" ? claims.email : "",
    user_metadata: userMetadata,
    app_metadata: appMetadata,
  });
}

export function isAdmin(user: { role?: unknown }) {
  return roleOf(user).split(",").map((role) => role.trim()).includes("admin");
}

export async function currentDashboardUser(): Promise<DashboardUser | null> {
  const supabase = await createSupabaseServerClient();
  // getClaims verifies the signed access token and avoids a remote Auth user
  // lookup for every dashboard API request when the project uses signing keys.
  // This removes Auth gateway latency from panel loading without trusting raw
  // cookie session data.
  let result = await supabase.auth.getClaims();
  if (result.error && (!result.error.status || result.error.status >= 500)) {
    await new Promise(resolve => setTimeout(resolve, 200));
    result = await supabase.auth.getClaims();
  }
  const { data, error } = result;
  if (error) {
    console.warn("Dashboard authentication failed", {name:error.name,code:error.code,status:error.status});
    if (!error.status || error.status >= 500 || error.status === 429) throw new HttpError(503,"Sign-in service is temporarily unavailable. Please retry.");
  }
  return data?.claims ? userFromClaims(data.claims as Record<string, unknown>) : null;
}

export async function requirePageUser(): Promise<DashboardUser> {
  const user = await currentDashboardUser();
  if (!user) redirect("/auth/sign-in");
  return user;
}

export async function requirePageAdmin(): Promise<DashboardUser> {
  const user = await requirePageUser();
  if (!isAdmin(user)) redirect("/");
  return user;
}

export async function requireApiUser() {
  const user = await currentDashboardUser();
  if (!user) {
    return { user: null, response: Response.json({ error: "Authentication required" }, { status: 401 }) } as const;
  }
  return { user, response: null } as const;
}

export async function requireApiAdmin() {
  const result = await requireApiUser();
  if (result.response) return result;
  if (!isAdmin(result.user)) {
    return { user: null, response: Response.json({ error: "Administrator access required" }, { status: 403 }) } as const;
  }
  return result;
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) return process.env.NODE_ENV !== "production";
  const protocol = request.headers.get("x-forwarded-proto") || (process.env.NODE_ENV === "production" ? "https" : "http");
  return origin === `${protocol}://${host}`;
}
