import { errorResponse } from "../../../../lib/http";
import { isSameOrigin, requireApiAdmin } from "../../../../lib/auth/access";
import { ensureSchema, getRuntimeEnv, logActivity } from "../../../../lib/database";

export const dynamic = "force-dynamic";

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  createdAt?: string | Date;
  lastSignInAt?: string | Date | null;
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
    // 1. Fetch from Supabase auth.users (primary user store)
    const supabaseRowsPromise = runtime.DB.prepare(`
      SELECT 
        id::text AS id,
        email,
        COALESCE(raw_user_meta_data->>'name', email) AS name,
        COALESCE(raw_app_meta_data->>'role', 'user') AS role,
        banned_until,
        created_at,
        last_sign_in_at
      FROM auth.users
      ORDER BY created_at DESC
    `).all<{
      id: string;
      email: string;
      name: string;
      role: string;
      banned_until: string | null;
      created_at: string;
      last_sign_in_at: string | null;
    }>().catch(() => ({ results: [] }));

    // 2. Fetch from local auth_users table (fallback/auxiliary user store)
    const localRowsPromise = runtime.DB.prepare(`
      SELECT id, email, name, role, banned_until, created_at, NULL AS last_sign_in_at
      FROM auth_users
      ORDER BY created_at DESC
    `).all<{
      id: string;
      email: string;
      name: string;
      role: string;
      banned_until: string | null;
      created_at: string;
      last_sign_in_at: string | null;
    }>().catch(() => ({ results: [] }));

    const [supabaseRows, localRows] = await Promise.all([supabaseRowsPromise, localRowsPromise]);

    const userMap = new Map<string, ManagedUser>();

    // Add local rows first
    for (const u of localRows.results) {
      const email = (u.email || "").trim().toLowerCase();
      if (!email) continue;
      userMap.set(email, {
        id: u.id,
        name: u.name || u.email || "",
        email: u.email || "",
        role: u.role || "user",
        banned: Boolean(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
        banReason: "",
        createdAt: String(u.created_at || ""),
        lastSignInAt: null,
      });
    }

    // Supabase auth.users takes precedence for live accounts
    for (const u of supabaseRows.results) {
      const email = (u.email || "").trim().toLowerCase();
      if (!email) continue;
      userMap.set(email, {
        id: u.id,
        name: u.name || u.email || "",
        email: u.email || "",
        role: u.role || "user",
        banned: Boolean(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
        banReason: "",
        createdAt: String(u.created_at || ""),
        lastSignInAt: u.last_sign_in_at ? String(u.last_sign_in_at) : null,
      });
    }

    const users = Array.from(userMap.values()).sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

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
  const userId = String(body.userId || "").trim();

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

    const existingAuth = await runtime.DB.prepare("SELECT id FROM auth.users WHERE LOWER(email) = LOWER(?)").bind(email).first().catch(() => null);
    const existingLocal = await runtime.DB.prepare("SELECT id FROM auth_users WHERE LOWER(email) = LOWER(?)").bind(email).first().catch(() => null);
    if (existingAuth || existingLocal) {
      return Response.json({ error: "A user with this email address already exists." }, { status: 409 });
    }

    // Insert into auth.users (Supabase primary store)
    const insertAuth = await runtime.DB.prepare(`
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        ?,
        crypt(?, gen_salt('bf', 10)),
        NOW(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', ?),
        jsonb_build_object('name', ?, 'email_verified', true),
        NOW(),
        NOW()
      )
      RETURNING id::text
    `).bind(email, password, role, name).first<{ id: string }>().catch(() => null);

    const newId = insertAuth?.id || `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Also mirror to local auth_users table
    await runtime.DB.prepare(`
      INSERT INTO auth_users (id, email, encrypted_password, name, role, created_at)
      VALUES (?, ?, crypt(?, gen_salt('bf', 10)), ?, ?, NOW())
      ON CONFLICT (id) DO NOTHING
    `).bind(newId, email, password, name, role).run().catch(() => null);

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

  if (action === "update_info") {
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const role = ["admin", "support_manager", "support_agent", "operations", "warehouse", "user"].includes(String(body.role)) ? String(body.role) : undefined;

    if (!name || (email && !/^\S+@\S+\.\S+$/.test(email))) {
      return Response.json({ error: "A valid name and email address are required" }, { status: 400 });
    }

    if (userId === access.user.id && role && role !== "admin") {
      return Response.json({ error: "You cannot remove your own administrator access" }, { status: 400 });
    }

    // Update in auth.users
    await runtime.DB.prepare(`
      UPDATE auth.users
      SET email = COALESCE(NULLIF(?, ''), email),
          raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('name', ?),
          raw_app_meta_data = CASE WHEN ? != '' THEN COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', ?) ELSE raw_app_meta_data END,
          updated_at = NOW()
      WHERE id::text = ?
    `).bind(email || "", name, role || "", role || "", userId).run().catch(() => null);

    // Update in auth_users
    await runtime.DB.prepare(`
      UPDATE auth_users
      SET email = COALESCE(NULLIF(?, ''), email),
          name = COALESCE(NULLIF(?, ''), name),
          role = CASE WHEN ? != '' THEN ? ELSE role END
      WHERE id = ?
    `).bind(email || "", name, role || "", role || "", userId).run().catch(() => null);

    await audit(access.user, "auth.user_updated", "Updated dashboard user details", {
      targetUserId: userId,
      name,
      email,
      role,
    });
    return Response.json({ ok: true, message: "User details updated successfully." });
  }

  if (action === "set_role") {
    const role = ["admin", "support_manager", "support_agent", "operations", "warehouse", "user"].includes(String(body.role)) ? String(body.role) : "user";
    if (userId === access.user.id && role !== "admin") {
      return Response.json({ error: "You cannot remove your own administrator access" }, { status: 400 });
    }
    await runtime.DB.prepare(`
      UPDATE auth.users
      SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', ?),
          updated_at = NOW()
      WHERE id::text = ?
    `).bind(role, userId).run().catch(() => null);

    await runtime.DB.prepare("UPDATE auth_users SET role = ? WHERE id = ?").bind(role, userId).run().catch(() => null);
    await audit(access.user, "auth.role_changed", "Changed a dashboard user role", { targetUserId: userId, role });
    return Response.json({ ok: true, message: "Role updated." });
  }

  if (action === "force_logout") {
    // Revoke all sessions and refresh tokens in Supabase auth
    await runtime.DB.prepare("DELETE FROM auth.refresh_tokens WHERE user_id::text = ?").bind(userId).run().catch(() => null);
    await runtime.DB.prepare("DELETE FROM auth.sessions WHERE user_id::text = ?").bind(userId).run().catch(() => null);
    await runtime.DB.prepare(`
      UPDATE auth.users
      SET reauthentication_sent_at = NOW(),
          updated_at = NOW()
      WHERE id::text = ?
    `).bind(userId).run().catch(() => null);

    await audit(access.user, "auth.force_logout", "Terminated all active sessions for user", { targetUserId: userId });
    return Response.json({ ok: true, message: "User forced out. All active sessions have been terminated." });
  }

  if (action === "disable") {
    if (userId === access.user.id) return Response.json({ error: "You cannot disable your own account" }, { status: 400 });

    await runtime.DB.prepare(`
      UPDATE auth.users
      SET banned_until = NOW() + INTERVAL '100 years',
          reauthentication_sent_at = NOW(),
          updated_at = NOW()
      WHERE id::text = ?
    `).bind(userId).run().catch(() => null);

    await runtime.DB.prepare("UPDATE auth_users SET banned_until = NOW() + INTERVAL '100 years' WHERE id = ?").bind(userId).run().catch(() => null);
    await runtime.DB.prepare("DELETE FROM auth.refresh_tokens WHERE user_id::text = ?").bind(userId).run().catch(() => null);
    await runtime.DB.prepare("DELETE FROM auth.sessions WHERE user_id::text = ?").bind(userId).run().catch(() => null);

    await audit(access.user, "auth.user_disabled", "Disabled a dashboard user", { targetUserId: userId });
    return Response.json({ ok: true, message: "User disabled and active sessions revoked." });
  }

  if (action === "enable") {
    await runtime.DB.prepare(`
      UPDATE auth.users
      SET banned_until = NULL,
          updated_at = NOW()
      WHERE id::text = ?
    `).bind(userId).run().catch(() => null);

    await runtime.DB.prepare("UPDATE auth_users SET banned_until = NULL WHERE id = ?").bind(userId).run().catch(() => null);
    await audit(access.user, "auth.user_enabled", "Enabled a dashboard user", { targetUserId: userId });
    return Response.json({ ok: true, message: "User enabled." });
  }

  if (action === "set_password") {
    const newPassword = String(body.password || "");
    if (newPassword.length < 8) return Response.json({ error: "The password must be at least 8 characters" }, { status: 400 });

    await runtime.DB.prepare(`
      UPDATE auth.users
      SET encrypted_password = crypt(?, gen_salt('bf', 10)),
          reauthentication_sent_at = NOW(),
          updated_at = NOW()
      WHERE id::text = ?
    `).bind(newPassword, userId).run().catch(() => null);

    await runtime.DB.prepare("UPDATE auth_users SET encrypted_password = crypt(?, gen_salt('bf', 10)) WHERE id = ?").bind(newPassword, userId).run().catch(() => null);
    await runtime.DB.prepare("DELETE FROM auth.refresh_tokens WHERE user_id::text = ?").bind(userId).run().catch(() => null);
    await runtime.DB.prepare("DELETE FROM auth.sessions WHERE user_id::text = ?").bind(userId).run().catch(() => null);

    await audit(access.user, "auth.password_changed", "Assigned a new dashboard password", { targetUserId: userId });
    return Response.json({ ok: true, message: "Password changed and existing sessions revoked." });
  }

  return Response.json({ error: "Unsupported action" }, { status: 400 });
}

export async function GET(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }

export async function POST(...args: Parameters<typeof handlePOST>) { try { return await handlePOST(...args); } catch (error) { return errorResponse(error); } }
