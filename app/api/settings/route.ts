import { errorResponse } from "../../../lib/http";
import { ensureSchema, getRuntimeEnv, logActivity, setSyncState } from "../../../lib/database";
import { requireApiUser, requireApiAdmin, isSameOrigin } from "../../../lib/auth/access";
import { invalidateCache } from "../../../lib/server-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await requireApiUser();
    if (access.response) return access.response;

    const runtime = getRuntimeEnv();
    await ensureSchema(runtime.DB);

    const row = await runtime.DB.prepare(
      "SELECT value FROM sync_state WHERE key = 'unshipped_orders_window_days'"
    ).first<{ value: string }>();

    const unshippedOrdersWindowDays = Math.max(1, Math.min(365, parseInt(row?.value || "30", 10) || 30));

    return Response.json({
      unshippedOrdersWindowDays,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireApiAdmin();
    if (access.response) return access.response;

    if (!isSameOrigin(request) && request.headers.get("x-requested-with") !== "satmi-orders-dashboard") {
      return Response.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const body = await request.json().catch(() => null) as { unshippedOrdersWindowDays?: unknown } | null;
    if (!body || typeof body.unshippedOrdersWindowDays === "undefined") {
      return Response.json({ error: "unshippedOrdersWindowDays is required" }, { status: 400 });
    }

    const days = parseInt(String(body.unshippedOrdersWindowDays), 10);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return Response.json({ error: "Window must be a whole number between 1 and 365 days" }, { status: 400 });
    }

    const runtime = getRuntimeEnv();
    await ensureSchema(runtime.DB);

    await setSyncState(runtime.DB, "unshipped_orders_window_days", String(days));
    invalidateCache();

    await logActivity(
      runtime.DB,
      "settings",
      "settings.window_updated",
      `Admin updated unshipped orders window to ${days} days`,
      { unshippedOrdersWindowDays: days },
      "info",
      {
        id: access.user.id,
        name: access.user.name || access.user.email,
        role: access.user.role || "admin",
      }
    );

    return Response.json({
      ok: true,
      unshippedOrdersWindowDays: days,
      message: `Unshipped orders window updated to ${days} days`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
