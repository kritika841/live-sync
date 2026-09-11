import { errorResponse } from "../../../../lib/http";
import { isSameOrigin, requireApiAdmin } from "../../../../lib/auth/access";
import { ensureSchema, getRuntimeEnv, logActivity } from "../../../../lib/database";
import { getSupabaseAdmin } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  createdAt?: string | Date;
};

function messageOf(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) return String(error.message || fallback);
  return fallback;
}

async function audit(actorEmail: string, eventType: string, message: string, details: Record<string, unknown>) {
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  await logActivity(runtime.DB, actorEmail, eventType, message, details);
}

async function handleGET() {
  const access = await requireApiAdmin();
  if (access.response) return access.response;
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return Response.json({ error: messageOf(error, "Could not load users") }, { status: 502 });

  const users = ((data?.users || []) as unknown as Array<ManagedUser & { app_metadata?: { role?: string }; user_metadata?: { name?: string }; banned_until?: string | null; created_at?: string }>).map((user) => ({
    id: user.id,
    name: user.user_metadata?.name || user.email || "",
    email: user.email || "",
    role: user.app_metadata?.role || "user",
    banned: Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now()),
    banReason: user.banReason || "",
    createdAt: String(user.created_at || ""),
  }));
  return Response.json({ users, total: Number(data?.total || users.length), currentUserId: access.user.id });
}

async function handlePOST(request: Request) {
  const access = await requireApiAdmin();
  if (access.response) return access.response;
  const supabaseAdmin = getSupabaseAdmin();
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
  const action = String(body.action || "");
  const userId = String(body.userId || "");

  if (action === "create") {
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    const role = ["admin", "support_manager", "support_agent", "operations", "warehouse", "user"].includes(String(body.role)) ? String(body.role) : "user";
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      return Response.json({ error: "A name, valid email, and password of at least 8 characters are required" }, { status: 400 });
    }

    const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name }, app_metadata: { role } });
    if (created.error) {
      return Response.json({ error: messageOf(created.error, "Could not create user") }, { status: created.error.status || 400 });
    }

    await audit(access.user.email, "auth.user_created", `Added dashboard user ${email}`, {
      targetUserId: created.data?.user.id,
      targetEmail: email,
      role,
    });
    return Response.json({
      ok: true,
      message: "User added. They can now sign in with the password you assigned.",
    }, { status: 201 });
  }

  if (!userId) return Response.json({ error: "User is required" }, { status: 400 });

  if (action === "set_role") {
    const role = ["admin", "support_manager", "support_agent", "operations", "warehouse", "user"].includes(String(body.role)) ? String(body.role) : "user";
    if (userId === access.user.id && role !== "admin") {
      return Response.json({ error: "You cannot remove your own administrator access" }, { status: 400 });
    }
    const result = await supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: { role } });
    if (result.error) return Response.json({ error: messageOf(result.error, "Could not update role") }, { status: result.error.status || 400 });
    await audit(access.user.email, "auth.role_changed", "Changed a dashboard user role", { targetUserId: userId, role });
    return Response.json({ ok: true, message: "Role updated." });
  }

  if (action === "disable") {
    if (userId === access.user.id) return Response.json({ error: "You cannot disable your own account" }, { status: 400 });
    const result = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (result.error) return Response.json({ error: messageOf(result.error, "Could not disable user") }, { status: result.error.status || 400 });
    await supabaseAdmin.auth.admin.signOut(userId, "global");
    await audit(access.user.email, "auth.user_disabled", "Disabled a dashboard user", { targetUserId: userId });
    return Response.json({ ok: true, message: "User disabled and active sessions revoked." });
  }

  if (action === "enable") {
    const result = await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "none" });
    if (result.error) return Response.json({ error: messageOf(result.error, "Could not enable user") }, { status: result.error.status || 400 });
    await audit(access.user.email, "auth.user_enabled", "Enabled a dashboard user", { targetUserId: userId });
    return Response.json({ ok: true, message: "User enabled." });
  }

  if (action === "set_password") {
    const newPassword = String(body.password || "");
    if (newPassword.length < 8) return Response.json({ error: "The password must be at least 8 characters" }, { status: 400 });
    const result = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
    if (result.error) return Response.json({ error: messageOf(result.error, "Could not set password") }, { status: result.error.status || 400 });
    await supabaseAdmin.auth.admin.signOut(userId, "global");
    await audit(access.user.email, "auth.password_changed", "Assigned a new dashboard password", { targetUserId: userId });
    return Response.json({ ok: true, message: "Password changed and existing sessions revoked." });
  }

  return Response.json({ error: "Unsupported action" }, { status: 400 });
}

export async function GET(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }

export async function POST(...args: Parameters<typeof handlePOST>) { try { return await handlePOST(...args); } catch (error) { return errorResponse(error); } }
