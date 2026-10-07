import { errorResponse } from "../../../../lib/http";
import { isSameOrigin, requireApiAdmin } from "../../../../lib/auth/access";
import { ensureSchema, getRuntimeEnv, logActivity } from "../../../../lib/database";

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

async function audit(actor: { id: string; email: string; name: string; role: string }, eventType: string, message: string, details: Record<string, unknown>) {
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  await logActivity(runtime.DB, "admin", eventType, message, details, "info", {
    id: actor.id,
    name: actor.name || actor.email,
    role: actor.role || "admin",
  });
}

async function handleGET() {
  const access = await requireApiAdmin();
  if (access.response) return access.response;

  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);

  try {
    const rows = await runtime.DB.prepare(`
      SELECT id, email, name, role, banned_until, created_at
      FROM auth_users
      ORDER BY created_at DESC
    `).all<{
      id: string;
      email: string;
      name: string;
      role: string;
      banned_until: string | null;
      created_at: string;
    }>();

    const users = rows.results.map((u) => ({
      id: u.id,
      name: u.name || u.email || "",
      email: u.email || "",
      role: u.role || "user",
      banned: Boolean(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
      banReason: "",
      createdAt: String(u.created_at || ""),
    }));

    return Response.json({ users, total: users.length, currentUserId: access.user.id });
  } catch (error) {
    return Response.json({ error: messageOf(error, "Could not load users") }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  const access = await requireApiAdmin();
  if (access.response) return access.response;
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
  const action = String(body.action || "");
  const userId = String(body.userId || "");

  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);

  if (action === "create") {
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    const role = ["admin", "support_manager", "support_agent", "operations", "warehouse", "user"].includes(String(body.role)) ? String(body.role) : "user";
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      return Response.json({ error: "A name, valid email, and password of at least 8 characters are required" }, { status: 400 });
    }

    const existing = await runtime.DB.prepare("SELECT id FROM auth_users WHERE LOWER(email) = LOWER(?)").bind(email).first();
    if (existing) {
      return Response.json({ error: "A user with this email address already exists." }, { status: 409 });
    }

    const newId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await runtime.DB.prepare(`
      INSERT INTO auth_users (id, email, encrypted_password, name, role, created_at)
      VALUES (?, ?, crypt(?, gen_salt('bf', 10)), ?, ?, NOW())
    `).bind(newId, email, password, name, role).run();

    await audit(access.user, "auth.user_created", `Added dashboard user ${email}`, {
      targetUserId: newId,
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
    await runtime.DB.prepare("UPDATE auth_users SET role = ? WHERE id = ?").bind(role, userId).run();
    await audit(access.user, "auth.role_changed", "Changed a dashboard user role", { targetUserId: userId, role });
    return Response.json({ ok: true, message: "Role updated." });
  }

  if (action === "disable") {
    if (userId === access.user.id) return Response.json({ error: "You cannot disable your own account" }, { status: 400 });
    await runtime.DB.prepare("UPDATE auth_users SET banned_until = NOW() + INTERVAL '100 years' WHERE id = ?").bind(userId).run();
    await audit(access.user, "auth.user_disabled", "Disabled a dashboard user", { targetUserId: userId });
    return Response.json({ ok: true, message: "User disabled and active sessions revoked." });
  }

  if (action === "enable") {
    await runtime.DB.prepare("UPDATE auth_users SET banned_until = NULL WHERE id = ?").bind(userId).run();
    await audit(access.user, "auth.user_enabled", "Enabled a dashboard user", { targetUserId: userId });
    return Response.json({ ok: true, message: "User enabled." });
  }

  if (action === "set_password") {
    const newPassword = String(body.password || "");
    if (newPassword.length < 8) return Response.json({ error: "The password must be at least 8 characters" }, { status: 400 });
    await runtime.DB.prepare("UPDATE auth_users SET encrypted_password = crypt(?, gen_salt('bf', 10)) WHERE id = ?").bind(newPassword, userId).run();
    await audit(access.user, "auth.password_changed", "Assigned a new dashboard password", { targetUserId: userId });
    return Response.json({ ok: true, message: "Password changed and existing sessions revoked." });
  }

  return Response.json({ error: "Unsupported action" }, { status: 400 });
}

export async function GET(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }

export async function POST(...args: Parameters<typeof handlePOST>) { try { return await handlePOST(...args); } catch (error) { return errorResponse(error); } }
