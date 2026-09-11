import { errorResponse } from "../../../lib/http";
import { ensureSchema, getRuntimeEnv } from "../../../lib/database";
import { requireApiUser } from "../../../lib/auth/access";

export const dynamic = "force-dynamic";

async function handleGET() {
  const access = await requireApiUser();
  if (access.response) return access.response;
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const rows = await runtime.DB.prepare(`
    SELECT id, source, event_type AS eventType, level, message,
      details_json AS detailsJson, created_at AS createdAt
    FROM activity_logs
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `).all<Record<string, unknown>>();
  const stateRows = await runtime.DB.prepare(`
    SELECT key, value FROM sync_state
    WHERE key IN ('sync_status', 'last_sync_at', 'last_sync_mode', 'last_sync_count', 'last_sync_error')
  `).all<{ key: string; value: string }>();
  return Response.json({
    logs: rows.results.map((row) => ({ ...row, details: JSON.parse(String(row.detailsJson || "{}")), detailsJson: undefined })),
    sync: Object.fromEntries(stateRows.results.map((row) => [row.key, row.value])),
  });
}

export async function GET(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }
