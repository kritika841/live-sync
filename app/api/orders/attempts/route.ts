import { requireApiUser } from "../../../../lib/auth/access";
import { getRuntimeEnv } from "../../../../lib/database";
import { errorResponse } from "../../../../lib/http";
import { parseDeliveryAttempts } from "../../../../lib/ndr-attempts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const access = await requireApiUser();
    if (access.response) return access.response;

    const runtime = getRuntimeEnv();
    const url = new URL(request.url);

    const orderId = url.searchParams.get("id") || url.searchParams.get("order_id");
    const channelOrderId = url.searchParams.get("channel_order_id");
    const awb = url.searchParams.get("awb");

    if (!orderId && !channelOrderId && !awb) {
      return Response.json({ error: "Missing order identifier (id, channel_order_id, or awb)" }, { status: 400 });
    }

    let orderQuery = "SELECT id, channel_order_id, awb, courier, status, ndr_attempts, ndr_reason, ndr_raised_at, first_out_for_delivery_at, out_for_delivery_at, delivered_at FROM orders WHERE ";
    const binds: unknown[] = [];
    if (orderId) {
      orderQuery += "id = ?";
      binds.push(Number(orderId));
    } else if (channelOrderId) {
      orderQuery += "channel_order_id = ?";
      binds.push(channelOrderId);
    } else if (awb) {
      orderQuery += "awb = ?";
      binds.push(awb);
    }

    const order = await runtime.DB.prepare(orderQuery).bind(...binds).first<Record<string, unknown>>();
    if (!order) {
      return Response.json({ error: "Order not found" }, { status: 404 });
    }

    // Query all related webhook events
    const eventQueryBinds: unknown[] = [];
    const eventConditions: string[] = [];
    if (order.id) {
      eventConditions.push("shiprocket_order_id = ?");
      eventQueryBinds.push(String(order.id));
    }
    if (order.channel_order_id) {
      eventConditions.push("channel_order_id = ?");
      eventQueryBinds.push(String(order.channel_order_id));
    }
    if (order.awb) {
      eventConditions.push("awb = ?");
      eventQueryBinds.push(String(order.awb));
    }

    const eventsRes = eventConditions.length
      ? await runtime.DB.prepare(`
          SELECT status, payload_json, event_at, received_at
          FROM webhook_events
          WHERE ${eventConditions.join(" OR ")}
          ORDER BY id ASC
        `).bind(...eventQueryBinds).all<{
          status: string;
          payload_json: string;
          event_at: string;
          received_at: string;
        }>()
      : { results: [] };

    const attempts = parseDeliveryAttempts(order, eventsRes.results);

    return Response.json({
      order: {
        id: order.id,
        channelOrderId: order.channel_order_id,
        awb: order.awb,
        courier: order.courier,
        status: order.status,
        ndrReason: order.ndr_reason,
        ndrAttempts: order.ndr_attempts,
      },
      attempts,
      totalAttempts: attempts.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
