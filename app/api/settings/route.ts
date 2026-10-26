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

    const rows = await runtime.DB.prepare(
      "SELECT key, value FROM sync_state WHERE key IN ('unshipped_orders_window_days', 'persistent_confirmation_queue', 'callback_delay_hours', 'cart_upsell_tag')"
    ).all<{ key: string; value: string }>();

    const state = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));

    const unshippedOrdersWindowDays = Math.max(1, Math.min(365, parseInt(state.unshipped_orders_window_days || "30", 10) || 30));
    const persistentConfirmationQueue = state.persistent_confirmation_queue === "true";
    const parsedHours = parseFloat(state.callback_delay_hours || "24");
    const callbackDelayHours = Number.isFinite(parsedHours) && parsedHours > 0 ? Math.min(720, parsedHours) : 24;
    const cartUpsellTag = String(state.cart_upsell_tag || "cart_upsell").trim() || "cart_upsell";

    return Response.json({
      unshippedOrdersWindowDays,
      persistentConfirmationQueue,
      callbackDelayHours,
      cartUpsellTag,
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

    const body = await request.json().catch(() => null) as {
      unshippedOrdersWindowDays?: unknown;
      persistentConfirmationQueue?: unknown;
      callbackDelayHours?: unknown;
      cartUpsellTag?: unknown;
    } | null;

    if (!body) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const runtime = getRuntimeEnv();
    await ensureSchema(runtime.DB);

    const updatedFields: Record<string, unknown> = {};

    if (typeof body.unshippedOrdersWindowDays !== "undefined") {
      const days = parseInt(String(body.unshippedOrdersWindowDays), 10);
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        return Response.json({ error: "Window must be a whole number between 1 and 365 days" }, { status: 400 });
      }
      await setSyncState(runtime.DB, "unshipped_orders_window_days", String(days));
      updatedFields.unshippedOrdersWindowDays = days;
    }

    if (typeof body.persistentConfirmationQueue !== "undefined") {
      const persistent = Boolean(body.persistentConfirmationQueue);
      await setSyncState(runtime.DB, "persistent_confirmation_queue", persistent ? "true" : "false");
      updatedFields.persistentConfirmationQueue = persistent;
    }

    if (typeof body.callbackDelayHours !== "undefined") {
      const hours = parseFloat(String(body.callbackDelayHours));
      if (!Number.isFinite(hours) || hours <= 0 || hours > 720) {
        return Response.json({ error: "Callback timeframe must be between 0.1 and 720 hours" }, { status: 400 });
      }
      await setSyncState(runtime.DB, "callback_delay_hours", String(hours));
      updatedFields.callbackDelayHours = hours;
    }

    if (typeof body.cartUpsellTag !== "undefined") {
      const tag = String(body.cartUpsellTag || "").trim() || "cart_upsell";
      await setSyncState(runtime.DB, "cart_upsell_tag", tag);
      updatedFields.cartUpsellTag = tag;
    }

    invalidateCache();

    await logActivity(
      runtime.DB,
      "settings",
      "settings.updated",
      `Admin updated dashboard settings`,
      updatedFields,
      "info",
      {
        id: access.user.id,
        name: access.user.name || access.user.email,
        role: access.user.role || "admin",
      }
    );

    const rows = await runtime.DB.prepare(
      "SELECT key, value FROM sync_state WHERE key IN ('unshipped_orders_window_days', 'persistent_confirmation_queue', 'callback_delay_hours', 'cart_upsell_tag')"
    ).all<{ key: string; value: string }>();
    const state = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));

    return Response.json({
      ok: true,
      unshippedOrdersWindowDays: Math.max(1, Math.min(365, parseInt(state.unshipped_orders_window_days || "30", 10) || 30)),
      persistentConfirmationQueue: state.persistent_confirmation_queue === "true",
      callbackDelayHours: Number.isFinite(parseFloat(state.callback_delay_hours || "24")) ? parseFloat(state.callback_delay_hours || "24") : 24,
      cartUpsellTag: String(state.cart_upsell_tag || "cart_upsell").trim() || "cart_upsell",
      message: "Settings updated successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
