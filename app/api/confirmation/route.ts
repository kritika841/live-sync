import { errorResponse } from "../../../lib/http";
import { ACTIONABLE_STATUS_SQL, extractOrderTags, routeConfirmationOrders } from "../../../lib/confirmation";
import { ensureSchema, getRuntimeEnv } from "../../../lib/database";
import { isSameOrigin, requireApiUser } from "../../../lib/auth/access";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || (process.env.NODE_ENV === "production" ? "https" : "http");
  return request.headers.get("x-requested-with") === "satmi-orders-dashboard"
    && request.headers.get("sec-fetch-site") === "same-origin"
    && Boolean(origin && host && origin === `${protocol}://${host}`);
}

const orderColumns = `o.id, o.channel_order_id AS channelOrderId, o.customer_name AS customerName,
  o.customer_phone AS customerPhone, o.customer_city AS customerCity, o.customer_state AS customerState,
  COALESCE(o.raw_json::jsonb->>'customer_address', '') AS customerAddress,
  COALESCE(o.raw_json::jsonb->>'customer_pincode', '') AS customerPincode,
  o.order_date AS orderDate, o.status, o.payment_method AS paymentMethod, o.total,
  o.products_json AS productsJson, o.raw_json AS rawJson, o.confirmation_status AS confirmationStatus,
  o.confirmation_updated_at AS confirmationUpdatedAt, o.confirmed_at AS confirmedAt, o.rejected_at AS rejectedAt,
  c.id AS campaignId, c.name AS campaignName, c.position AS campaignPosition, ca.position AS orderPosition`;

const candidateColumns = `o.id, o.channel_order_id AS channelOrderId, o.customer_name AS customerName,
  o.customer_phone AS customerPhone, o.order_date AS orderDate, o.payment_method AS paymentMethod,
  o.raw_json AS rawJson, o.confirmation_status AS confirmationStatus, c.id AS campaignId, c.name AS campaignName`;

function serializeOrder(row: Record<string, unknown>, attempts: Record<string, unknown>[] = []) {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(String(row.rawJson || "{}")); } catch { /* Keep malformed legacy payloads usable. */ }
  return {
    ...row,
    products: JSON.parse(String(row.productsJson || "[]")),
    productsJson: undefined,
    rawJson: undefined,
    tags: extractOrderTags(raw),
    attempts,
  };
}

function serializeCandidate(row: Record<string, unknown>) {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(String(row.rawJson || "{}")); } catch { /* Keep malformed legacy payloads usable. */ }
  return { ...row, rawJson: undefined, products: [], attempts: [], tags: extractOrderTags(raw) };
}

async function handleGET(request: Request) {
  const access = await requireApiUser();
  if (access.response) return access.response;
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const url = new URL(request.url);
  const section = url.searchParams.get("section") === "campaigns" ? "campaigns" : "confirmation";
  const requestedMode = url.searchParams.get("mode");
  const mode = requestedMode === "confirmed" || requestedMode === "rejected" ? requestedMode : "queue";
  const now = new Date().toISOString();

  if (section === "campaigns") {
    const [campaigns, candidates] = await Promise.all([
      runtime.DB.prepare(`SELECT c.id, c.name, c.description, c.criteria_json AS criteriaJson, c.position,
        c.is_active AS isActive, c.auto_assign AS autoAssign, COUNT(ca.order_id) AS orderCount
        FROM campaigns c LEFT JOIN campaign_assignments ca ON ca.campaign_id=c.id
        GROUP BY c.id ORDER BY c.position, c.created_at`).all<Record<string, unknown>>(),
      runtime.DB.prepare(`SELECT ${candidateColumns}
        FROM orders o LEFT JOIN campaign_assignments ca ON ca.order_id=o.id LEFT JOIN campaigns c ON c.id=ca.campaign_id
        WHERE ${ACTIONABLE_STATUS_SQL} AND o.confirmation_status NOT IN ('confirmed','rejected')
        ORDER BY COALESCE(NULLIF(o.order_date,''),o.created_at) DESC`).all<Record<string, unknown>>(),
    ]);
    const serializedCandidates = candidates.results.map((row) => serializeCandidate(row));
    const availableTags = [...new Map(serializedCandidates.flatMap((order) => order.tags).map((tag) => [tag.trim().toLowerCase(), tag.trim()])).values()]
      .filter(Boolean).sort((left, right) => left.localeCompare(right));
    return Response.json({
      campaigns: campaigns.results.map((row) => ({ ...row, criteria: JSON.parse(String(row.criteriaJson || "{}")), criteriaJson: undefined })),
      candidates: serializedCandidates,
      availableTags,
    });
  }

  const listQuery = mode === "confirmed"
    ? runtime.DB.prepare(`SELECT ${orderColumns}
      FROM orders o LEFT JOIN campaign_assignments ca ON ca.order_id=o.id LEFT JOIN campaigns c ON c.id=ca.campaign_id
      WHERE o.confirmation_status='confirmed' ORDER BY o.confirmed_at DESC, o.id DESC`)
    : mode === "rejected"
      ? runtime.DB.prepare(`SELECT ${orderColumns}
        FROM orders o LEFT JOIN campaign_assignments ca ON ca.order_id=o.id LEFT JOIN campaigns c ON c.id=ca.campaign_id
        WHERE o.confirmation_status='rejected' ORDER BY o.rejected_at DESC, o.id DESC`)
      : runtime.DB.prepare(`SELECT ${orderColumns}
      FROM orders o JOIN campaign_assignments ca ON ca.order_id=o.id JOIN campaigns c ON c.id=ca.campaign_id
      WHERE o.confirmation_status IN ('pending','callback','unreachable') AND ${ACTIONABLE_STATUS_SQL}
        AND NOT EXISTS (SELECT 1 FROM confirmation_attempts latest WHERE latest.order_id=o.id AND latest.next_action_at<>'' AND latest.next_action_at>?
          AND latest.id=(SELECT MAX(last_attempt.id) FROM confirmation_attempts last_attempt WHERE last_attempt.order_id=o.id))
      ORDER BY c.position, ca.position, COALESCE(NULLIF(o.order_date,''),o.created_at), o.id`).bind(now);
  const [orders, countRow] = await Promise.all([
    listQuery.all<Record<string, unknown>>(),
    runtime.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM orders o JOIN campaign_assignments ca ON ca.order_id=o.id
        WHERE o.confirmation_status IN ('pending','callback','unreachable') AND ${ACTIONABLE_STATUS_SQL}
          AND NOT EXISTS (SELECT 1 FROM confirmation_attempts latest WHERE latest.order_id=o.id AND latest.next_action_at<>'' AND latest.next_action_at>?
            AND latest.id=(SELECT MAX(last_attempt.id) FROM confirmation_attempts last_attempt WHERE last_attempt.order_id=o.id))) AS queue,
      (SELECT COUNT(*) FROM orders WHERE confirmation_status='confirmed') AS confirmed,
      (SELECT COUNT(*) FROM orders WHERE confirmation_status='rejected') AS rejected`).bind(now).first<{ queue: number; confirmed: number; rejected: number }>(),
  ]);
  const visibleIds = orders.results.map((row) => Number(row.id));
  const attemptRows = visibleIds.length ? await runtime.DB.prepare(`SELECT id, order_id AS orderId, attempt_number AS attemptNumber,
    outcome, note, call_picked AS callPicked, rejection_reason AS rejectionReason, callback_at AS callbackAt,
    next_action_at AS nextActionAt, created_at AS createdAt FROM confirmation_attempts
    WHERE order_id IN (${visibleIds.map(() => "?").join(",")}) ORDER BY order_id, attempt_number`).bind(...visibleIds).all<Record<string, unknown>>() : { results: [] };
  const attemptsByOrder = new Map<number, Record<string, unknown>[]>();
  for (const attempt of attemptRows.results) {
    const id = Number(attempt.orderId);
    attemptsByOrder.set(id, [...(attemptsByOrder.get(id) || []), attempt]);
  }
  const serialized = orders.results.map((row) => serializeOrder(row, attemptsByOrder.get(Number(row.id)) || []));
  const counts = {
    queue: Number(countRow?.queue || 0),
    confirmed: Number(countRow?.confirmed || 0),
    rejected: Number(countRow?.rejected || 0),
    approved: Number(countRow?.confirmed || 0),
  };
  return Response.json({
    [mode]: serialized,
    counts,
  });
}

async function handlePOST(request: Request) {
  const access = await requireApiUser();
  if (access.response) return access.response;
  if (["support_agent","support_manager","warehouse"].includes(access.user.role)) return Response.json({error:"Order confirmation access required"},{status:403});
  if (!sameOrigin(request) || !isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
  const action = String(body.action || "");
  const now = new Date().toISOString();
  try {
    if (action === "create_campaign") {
      const name = String(body.name || "").trim();
      const description = String(body.description || "").trim();
      const inputCriteria = body.criteria && typeof body.criteria === "object" ? body.criteria as Record<string, unknown> : {};
      const tags = Array.isArray(inputCriteria.tags) ? [...new Set(inputCriteria.tags.map(String).map((tag) => tag.trim()).filter(Boolean))].slice(0, 50) : [];
      let dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(inputCriteria.dateFrom || "")) ? String(inputCriteria.dateFrom) : "";
      let dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(inputCriteria.dateTo || "")) ? String(inputCriteria.dateTo) : "";
      if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
      const paymentMethod = ["cod", "prepaid"].includes(String(inputCriteria.paymentMethod || "").toLowerCase()) ? String(inputCriteria.paymentMethod).toLowerCase() : "all";
      const criteria = { tags, dateFrom, dateTo, paymentMethod };
      const orderIds = Array.isArray(body.orderIds) ? [...new Set(body.orderIds.map(Number).filter(Boolean))].slice(0, 500) : [];
      const autoAssign = Boolean(body.autoAssign);
      if (!name) throw new Error("Campaign name is required");
      if (!orderIds.length && !autoAssign) throw new Error("Select at least one order or enable automatic assignment");
      const max = await runtime.DB.prepare("SELECT COALESCE(MAX(position),0) AS position FROM campaigns").first<{ position: number }>();
      const campaignId = `cmp_${crypto.randomUUID()}`;
      const statements = [runtime.DB.prepare(`INSERT INTO campaigns
        (id,name,description,criteria_json,position,is_active,auto_assign,created_at,updated_at)
        VALUES (?,?,?,?,?,TRUE,?,?,?)`).bind(campaignId, name, description, JSON.stringify(criteria), Number(max?.position || 0) + 1, autoAssign, now, now)];
      orderIds.forEach((orderId, index) => {
        statements.push(runtime.DB.prepare(`INSERT INTO campaign_assignments (campaign_id,order_id,position,created_at)
          VALUES (?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET campaign_id=excluded.campaign_id,position=excluded.position,created_at=excluded.created_at`).bind(campaignId, orderId, index, now));
        statements.push(runtime.DB.prepare("UPDATE orders SET confirmation_status=CASE WHEN confirmation_status='not_required' THEN 'pending' ELSE confirmation_status END,confirmation_updated_at=? WHERE id=? AND confirmation_status NOT IN ('confirmed','rejected')").bind(now, orderId));
      });
      statements.push(runtime.DB.prepare("INSERT INTO activity_logs (source,event_type,level,message,details_json,created_at) VALUES ('confirmation','campaign.created','info',?,?,?)").bind(`Campaign ${name} created`, JSON.stringify({ campaignId, orderCount: orderIds.length, autoAssign }), now));
      await runtime.DB.batch(statements);
      if (autoAssign) {
        const available = await runtime.DB.prepare(`SELECT id FROM orders WHERE ${ACTIONABLE_STATUS_SQL} AND confirmation_status NOT IN ('confirmed','rejected')`).all<{ id: number }>();
        await routeConfirmationOrders(runtime.DB, available.results.map((row) => Number(row.id)));
      }
      return Response.json({ ok: true, campaignId });
    }
    if (action === "reorder_campaigns") {
      const ids = Array.isArray(body.campaignIds) ? body.campaignIds.map(String) : [];
      if (!ids.length) throw new Error("Campaign order is required");
      await runtime.DB.batch(ids.map((id, index) => runtime.DB.prepare("UPDATE campaigns SET position=?,updated_at=? WHERE id=?").bind(index, now, id)));
      return Response.json({ ok: true });
    }
    if (action === "set_campaign_routing") {
      const campaignId = String(body.campaignId || "");
      if (campaignId !== "cmp_default_high_rto") throw new Error("Manual override is only available for the permanent campaign");
      await runtime.DB.prepare("UPDATE campaigns SET auto_assign=?,updated_at=? WHERE id=? AND is_active=TRUE")
        .bind(Boolean(body.autoAssign), now, campaignId).run();
      return Response.json({ ok: true });
    }
    if (action === "deactivate_campaign") {
      const campaignId = String(body.campaignId || "");
      if (!campaignId) throw new Error("Campaign is required");
      await runtime.DB.batch([
        runtime.DB.prepare("UPDATE campaigns SET is_active=FALSE,updated_at=? WHERE id=?").bind(now, campaignId),
        runtime.DB.prepare("DELETE FROM campaign_assignments WHERE campaign_id=?").bind(campaignId),
      ]);
      return Response.json({ ok: true });
    }
    const orderId = Number(body.orderId);
    if (!orderId) throw new Error("Order is required");
    const order = await runtime.DB.prepare("SELECT id,channel_order_id AS channelOrderId,confirmation_status AS confirmationStatus FROM orders WHERE id=?").bind(orderId).first<{ id: number; channelOrderId: string; confirmationStatus: string }>();
    if (!order) throw new Error("Order was not found");
    if (["confirmed", "rejected"].includes(order.confirmationStatus)) throw new Error("This order has already been completed");
    const note = String(body.note || "").trim();
    if (!note) throw new Error("A note is required");
    const attemptCount = await runtime.DB.prepare("SELECT COUNT(*) AS total FROM confirmation_attempts WHERE order_id=?").bind(orderId).first<{ total: number }>();
    const attemptNumber = Number(attemptCount?.total || 0) + 1;
    if (["callback", "unreachable"].includes(action) && attemptNumber > 3) throw new Error("Only three recall attempts are allowed");
    if (!["confirm", "callback", "unreachable", "reject"].includes(action)) throw new Error("Unsupported confirmation action");
    const outcome = action === "confirm" ? "confirmed" : action === "reject" ? "rejected" : action;
    const callbackAt = action === "callback" && body.callbackAt ? String(body.callbackAt) : "";
    const nextActionAt = ["callback", "unreachable"].includes(action)
      ? (callbackAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()) : "";
    const reason = action === "reject" ? String(body.rejectionReason || "other") : "";
    const confirmedAt = action === "confirm" ? now : "";
    const rejectedAt = action === "reject" ? now : "";
    await runtime.DB.batch([
      runtime.DB.prepare(`INSERT INTO confirmation_attempts
        (order_id,attempt_number,outcome,note,call_picked,rejection_reason,callback_at,next_action_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind(orderId, attemptNumber, outcome, note, action !== "unreachable", reason, callbackAt, nextActionAt, now),
      runtime.DB.prepare(`UPDATE orders SET confirmation_status=?,confirmation_updated_at=?,confirmed_at=CASE WHEN ?<>'' THEN ? ELSE confirmed_at END,
        rejected_at=CASE WHEN ?<>'' THEN ? ELSE rejected_at END WHERE id=?`).bind(outcome, now, confirmedAt, confirmedAt, rejectedAt, rejectedAt, orderId),
      runtime.DB.prepare("INSERT INTO activity_logs (source,event_type,level,message,details_json,created_at) VALUES ('confirmation',?,'info',?,?,?)")
        .bind(`order.${outcome}`, `Order ${order.channelOrderId} marked ${outcome}`, JSON.stringify({ orderId, note, rejectionReason: reason, nextActionAt }), now),
    ]);
    return Response.json({ ok: true, status: outcome });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Confirmation action failed" }, { status: 422 });
  }
}

export async function GET(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }

export async function POST(...args: Parameters<typeof handlePOST>) { try { return await handlePOST(...args); } catch (error) { return errorResponse(error); } }
