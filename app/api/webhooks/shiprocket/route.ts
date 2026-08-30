import { ensureSchema, getRuntimeEnv } from "../../../../lib/database";
import { fetchSpecificOrder } from "../../../../lib/shiprocket";

export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

const intValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const textValue = (value: unknown) => value == null ? "" : String(value);

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const secret = runtime.SHIPROCKET_WEBHOOK_SECRET || "";
  const provided = request.headers.get("x-api-key")
    || request.headers.get("x-webhook-token")
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    || new URL(request.url).searchParams.get("token")
    || "";
  if (!safeEqual(provided, secret)) return Response.json({ error: "Invalid webhook token" }, { status: 401 });

  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  await ensureSchema(runtime.DB);
  const now = new Date().toISOString();
  const shiprocketOrderId = intValue(payload.sr_order_id || payload.shiprocket_order_id);
  const channelOrderId = textValue(payload.order_id || payload.channel_order_id);
  const shipmentId = intValue(payload.shipment_id);
  const awb = textValue(payload.awb || payload.awb_code);
  const status = textValue(payload.current_status || payload.status || payload.shipment_status);

  await runtime.DB.prepare(`
    INSERT INTO webhook_events (shiprocket_order_id, channel_order_id, shipment_id, awb, status, payload_json, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(shiprocketOrderId, channelOrderId || null, shipmentId, awb || null, status || null, JSON.stringify(payload), now).run();

  if (status) {
    if (shiprocketOrderId) {
      await runtime.DB.prepare("UPDATE orders SET status = ?, synced_at = ? WHERE id = ?").bind(status, now, shiprocketOrderId).run();
    } else if (shipmentId) {
      await runtime.DB.prepare("UPDATE orders SET status = ?, synced_at = ? WHERE shipment_id = ?").bind(status, now, shipmentId).run();
    } else if (awb) {
      await runtime.DB.prepare("UPDATE orders SET status = ?, synced_at = ? WHERE awb = ?").bind(status, now, awb).run();
    } else if (channelOrderId) {
      await runtime.DB.prepare("UPDATE orders SET status = ?, synced_at = ? WHERE channel_order_id = ?").bind(status, now, channelOrderId).run();
    }
  }

  if (shiprocketOrderId) {
    try { await fetchSpecificOrder(runtime, shiprocketOrderId); } catch { /* Daily reconciliation repairs any transient API miss. */ }
  }
  return Response.json({ received: true });
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "Shiprocket order status webhook" });
}
