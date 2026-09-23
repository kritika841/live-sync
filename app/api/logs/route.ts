import { errorResponse } from "../../../lib/http";
import { ensureSchema, getRuntimeEnv } from "../../../lib/database";
import { requireApiUser, isAdmin } from "../../../lib/auth/access";

export const dynamic = "force-dynamic";

async function handleGET() {
  const access = await requireApiUser();
  if (access.response) return access.response;
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const user = access.user;
  const isAdminUser = isAdmin(user);
  const isManagerUser = user.role === "support_manager";

  let whereClause = "";
  const filterParams: unknown[] = [];

  if (isAdminUser) {
    // Admin sees everything
    whereClause = "";
  } else if (isManagerUser) {
    // Support manager sees non-admin activities (agents, warehouse, operations, system), but NOT admin activities
    whereClause = "WHERE actor_role != 'admin' AND COALESCE(details_json::jsonb->>'actorRole', '') != 'admin'";
  } else {
    // Support agents and all other roles only see activity performed by that specific agent
    whereClause = "WHERE (actor_id = ? OR details_json::jsonb->>'actorId' = ?)";
    filterParams.push(user.id, user.id);
  }

  const query = `
    SELECT id, source, event_type AS eventType, level, message,
      details_json AS detailsJson, created_at AS createdAt,
      actor_id AS actorId, actor_name AS actorName, actor_role AS actorRole
    FROM activity_logs
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `;

  const rows = await runtime.DB.prepare(query).bind(...filterParams).all<Record<string, unknown>>();
  const stateRows = await runtime.DB.prepare(`
    SELECT key, value FROM sync_state
    WHERE key IN ('sync_status', 'last_sync_at', 'last_sync_mode', 'last_sync_count', 'last_sync_error')
  `).all<{ key: string; value: string }>();

  return Response.json({
    logs: rows.results.map((row) => {
      let details: Record<string, unknown> = {};
      try { details = JSON.parse(String(row.detailsJson || "{}")); } catch {}
      const actorId = String(row.actorId || details.actorId || "");
      const actorName = String(row.actorName || details.actorName || (actorId === "system" ? "System" : ""));
      const actorRole = String(row.actorRole || details.actorRole || (actorId === "system" ? "system" : ""));
      return {
        ...row,
        actorId,
        actorName,
        actorRole,
        details,
        detailsJson: undefined,
      };
    }),
    sync: Object.fromEntries(stateRows.results.map((row) => [row.key, row.value])),
    role: user.role,
    userId: user.id,
  });
}

export async function GET(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }
