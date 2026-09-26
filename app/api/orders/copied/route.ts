import { errorResponse } from "../../../../lib/http";
import { ensureCopiedOrdersSchema, getRuntimeEnv } from "../../../../lib/database";
import { requireApiUser, requireApiAdmin } from "../../../../lib/auth/access";
import { sqlForTab } from "../../../../lib/order-status";

export const dynamic = "force-dynamic";

function safeProducts(value: unknown) {
  try {
    const data = JSON.parse(String(value || "[]"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireApiUser();
    if (access.response) return access.response;
    const user = access.user;

    const runtime = getRuntimeEnv();
    await ensureCopiedOrdersSchema(runtime.DB);

    const body = (await request.json().catch(() => ({}))) as {
      orderIds?: (number | string)[];
      channelOrderIds?: string[];
      tab?: string;
      copyAllUncopied?: boolean;
    };

    const now = new Date().toISOString();
    let targetOrders: Array<{ id: string | number; channelOrderId: string }> = [];

    if (body.copyAllUncopied) {
      // Fetch cutoff date from window days
      const windowDaysRow = await runtime.DB.prepare(
        "SELECT value FROM sync_state WHERE key = 'unshipped_orders_window_days'"
      ).first<{ value: string }>().catch(() => null);
      const days = Math.max(1, Math.min(365, parseInt(windowDaysRow?.value || "30", 10) || 30));
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const rows = await runtime.DB.prepare(`
        SELECT id, channel_order_id AS channelOrderId
        FROM orders
        WHERE (copied_at IS NULL OR copied_at = '')
          AND (${sqlForTab("new")})
          AND SUBSTR(COALESCE(NULLIF(order_date, ''), created_at), 1, 10) >= ?
        ORDER BY COALESCE(NULLIF(order_date, ''), created_at) DESC
        LIMIT 500
      `).bind(cutoffDate).all<{ id: string | number; channelOrderId: string }>();

      targetOrders = rows.results;
    } else {
      const orderIds = (Array.isArray(body.orderIds) ? body.orderIds : [])
        .map((id) => Number(id))
        .filter((n) => !Number.isNaN(n) && n > 0);

      const channelOrderIds = (Array.isArray(body.channelOrderIds) ? body.channelOrderIds : [])
        .map((id) => String(id).replace(/^#+/, "").trim())
        .filter(Boolean);

      if (orderIds.length === 0 && channelOrderIds.length === 0) {
        return Response.json({ success: true, count: 0, orderIds: [], channelOrderIds: [] });
      }

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (orderIds.length > 0) {
        conditions.push("id = ANY(?::bigint[])");
        params.push(orderIds);
      }
      if (channelOrderIds.length > 0) {
        conditions.push("channel_order_id = ANY(?::text[])");
        params.push(channelOrderIds);
      }

      const rows = await runtime.DB.prepare(`
        SELECT id, channel_order_id AS channelOrderId
        FROM orders
        WHERE ${conditions.join(" OR ")}
      `).bind(...params).all<{ id: string | number; channelOrderId: string }>();

      targetOrders = rows.results;
    }

    if (targetOrders.length === 0) {
      return Response.json({ success: true, count: 0, orderIds: [], channelOrderIds: [] });
    }

    const matchedIds = targetOrders.map((o) => Number(o.id)).filter((n) => !Number.isNaN(n));
    const matchedChannelIds = targetOrders.map((o) => o.channelOrderId.replace(/^#+/, "").trim());
    const channelIdsString = matchedChannelIds.join(",");

    // Update orders with copy metadata
    await runtime.DB.prepare(`
      UPDATE orders
      SET copied_at = ?,
          copied_by = ?,
          copied_by_name = ?,
          copied_count = COALESCE(copied_count, 0) + 1
      WHERE id = ANY(?::bigint[])
    `).bind(now, user.id, user.name, matchedIds).run();

    // Insert copy log entry
    await runtime.DB.prepare(`
      INSERT INTO order_copy_logs (actor_id, actor_name, actor_role, order_count, channel_order_ids, order_ids_json, tab, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      user.id,
      user.name,
      user.role,
      targetOrders.length,
      channelIdsString,
      JSON.stringify(matchedChannelIds),
      body.tab || "",
      now
    ).run();

    // Also record into activity logs
    await runtime.DB.prepare(`
      INSERT INTO activity_logs (source, event_type, level, message, details_json, created_at, actor_id, actor_name, actor_role)
      VALUES ('orders', 'orders.ids_copied', 'info', ?, ?, ?, ?, ?, ?)
    `).bind(
      `Copied ${targetOrders.length} order ID${targetOrders.length > 1 ? "s" : ""}`,
      JSON.stringify({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        orderCount: targetOrders.length,
        channelOrderIds: matchedChannelIds.slice(0, 50),
        tab: body.tab || "",
      }),
      now,
      user.id,
      user.name,
      user.role
    ).run().catch(() => null);

    return Response.json({
      success: true,
      count: targetOrders.length,
      orderIds: matchedIds,
      channelOrderIds: matchedChannelIds,
      copiedAt: now,
      copiedBy: user.id,
      copiedByName: user.name,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    // Admin only endpoint
    const access = await requireApiAdmin();
    if (access.response) return access.response;

    const runtime = getRuntimeEnv();
    await ensureCopiedOrdersSchema(runtime.DB);

    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim() || "";

    // Window cutoff date for new orders
    const windowDaysRow = await runtime.DB.prepare(
      "SELECT value FROM sync_state WHERE key = 'unshipped_orders_window_days'"
    ).first<{ value: string }>().catch(() => null);
    const days = Math.max(1, Math.min(365, parseInt(windowDaysRow?.value || "30", 10) || 30));
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 1. Stats
    const [uncopiedNewCountRow, totalCopiedCountRow, totalBatchesRow, lastCopyRow] = await Promise.all([
      runtime.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM orders
        WHERE (copied_at IS NULL OR copied_at = '')
          AND (${sqlForTab("new")})
          AND SUBSTR(COALESCE(NULLIF(order_date, ''), created_at), 1, 10) >= ?
      `).bind(cutoffDate).first<{ count: string | number }>().catch(() => ({ count: 0 })),
      runtime.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM orders
        WHERE copied_at IS NOT NULL AND copied_at <> ''
      `).first<{ count: string | number }>().catch(() => ({ count: 0 })),
      runtime.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM order_copy_logs
      `).first<{ count: string | number }>().catch(() => ({ count: 0 })),
      runtime.DB.prepare(`
        SELECT actor_id AS "actorId", actor_name AS "actorName", actor_role AS "actorRole",
          order_count AS "orderCount", created_at AS "createdAt"
        FROM order_copy_logs
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).first<Record<string, unknown>>().catch(() => null),
    ]);

    // Search filters
    let searchSql = "";
    const searchParams: unknown[] = [];
    if (search) {
      searchSql = "AND (channel_order_id LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)";
      const term = `%${search}%`;
      searchParams.push(term, term, term);
    }

    // 2. Uncopied New Orders (up to 150)
    const uncopiedRows = await runtime.DB.prepare(`
      SELECT id, channel_order_id AS channelOrderId, channel_name AS channelName,
        customer_name AS customerName, customer_phone AS customerPhone,
        customer_city AS customerCity, customer_state AS customerState,
        COALESCE(NULLIF(order_date, ''), created_at) AS orderDate,
        status, payment_method AS paymentMethod, total, products_json AS productsJson,
        copied_at AS copiedAt, copied_by_name AS copiedByName, copied_count AS copiedCount
      FROM orders
      WHERE (copied_at IS NULL OR copied_at = '')
        AND (${sqlForTab("new")})
        AND SUBSTR(COALESCE(NULLIF(order_date, ''), created_at), 1, 10) >= ?
        ${searchSql}
      ORDER BY COALESCE(NULLIF(order_date, ''), created_at) DESC, id DESC
      LIMIT 150
    `).bind(cutoffDate, ...searchParams).all<Record<string, unknown>>();

    // 3. Copied Orders (up to 150)
    const copiedRows = await runtime.DB.prepare(`
      SELECT id, channel_order_id AS channelOrderId, channel_name AS channelName,
        customer_name AS customerName, customer_phone AS customerPhone,
        customer_city AS customerCity, customer_state AS customerState,
        COALESCE(NULLIF(order_date, ''), created_at) AS orderDate,
        status, payment_method AS paymentMethod, total, products_json AS productsJson,
        copied_at AS copiedAt, copied_by_name AS copiedByName, copied_count AS copiedCount
      FROM orders
      WHERE copied_at IS NOT NULL AND copied_at <> ''
        ${searchSql}
      ORDER BY copied_at DESC, id DESC
      LIMIT 150
    `).bind(...searchParams).all<Record<string, unknown>>();

    // 4. Copy History Logs (up to 100)
    let logsSearchSql = "";
    const logsSearchParams: unknown[] = [];
    if (search) {
      logsSearchSql = "WHERE actor_name LIKE ? OR channel_order_ids LIKE ? OR tab LIKE ?";
      const term = `%${search}%`;
      logsSearchParams.push(term, term, term);
    }

    const logRows = await runtime.DB.prepare(`
      SELECT id, actor_id AS actorId, actor_name AS actorName, actor_role AS actorRole,
        order_count AS orderCount, channel_order_ids AS channelOrderIds,
        order_ids_json AS orderIdsJson, tab, created_at AS createdAt
      FROM order_copy_logs
      ${logsSearchSql}
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `).bind(...logsSearchParams).all<Record<string, unknown>>();

    return Response.json({
      stats: {
        uncopiedNewCount: Number(uncopiedNewCountRow?.count || 0),
        totalCopiedCount: Number(totalCopiedCountRow?.count || 0),
        totalCopyBatches: Number(totalBatchesRow?.count || 0),
        lastCopy: lastCopyRow || null,
      },
      uncopiedOrders: uncopiedRows.results.map((row) => ({
        ...row,
        products: safeProducts(row.productsJson),
        productsJson: undefined,
      })),
      copiedOrders: copiedRows.results.map((row) => ({
        ...row,
        products: safeProducts(row.productsJson),
        productsJson: undefined,
      })),
      logs: logRows.results.map((row) => {
        let ids: string[] = [];
        try {
          ids = JSON.parse(String(row.orderIdsJson || "[]"));
        } catch {
          ids = String(row.channelOrderIds || "").split(",").filter(Boolean);
        }
        return {
          ...row,
          orderIds: ids,
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
