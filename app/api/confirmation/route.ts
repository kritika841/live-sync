import { completePhone } from "../../../lib/contact";
import { shopifyOrderContacts } from "../../../lib/shopify";
import { errorResponse } from "../../../lib/http";
import { ACTIONABLE_STATUS_SQL, HIGH_RISK_SQL, extractOrderTags, routeConfirmationOrders } from "../../../lib/confirmation";
import { ensureConfirmationSchema, getRuntimeEnv } from "../../../lib/database";
import { isAdmin, isSameOrigin, requireApiUser } from "../../../lib/auth/access";

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
  o.awb, o.courier, o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt",
  o.products_json AS productsJson, o.raw_json AS rawJson, o.confirmation_status AS confirmationStatus,
  o.confirmation_updated_at AS confirmationUpdatedAt, o.confirmed_at AS confirmedAt, o.rejected_at AS rejectedAt,
  o.delay_reason AS "delayReason", o.delay_reason_updated_at AS "delayReasonUpdatedAt",
  o.confirmation_assignee_id AS confirmationAssigneeId, COALESCE(a.name, '') AS confirmationAssigneeName,
  c.id AS campaignId, c.name AS campaignName, c.position AS campaignPosition, ca.position AS orderPosition,
  ca.created_at AS assignedAt`;

const candidateColumns = `o.id, o.channel_order_id AS channelOrderId, o.customer_name AS customerName,
  o.customer_phone AS customerPhone, o.order_date AS orderDate, o.payment_method AS paymentMethod,
  o.raw_json AS rawJson, o.confirmation_status AS confirmationStatus, c.id AS campaignId, c.name AS campaignName`;

function sourcePhone(row: Record<string, unknown>) {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(String(row.rawJson || "{}")); } catch { /* Keep malformed legacy payloads usable. */ }
  const others = raw.others && typeof raw.others === "object" ? raw.others as Record<string, unknown> : {};
  const values = [row.customerPhone, raw.customer_phone_unmasked, raw.billing_phone, raw.shipping_phone, raw.billing_phone_number, raw.shipping_phone_number, raw.phone, others.billing_phone_number, others.shipping_phone_number, others.billing_phone, others.shipping_phone, others.phone].map(value => String(value || "").trim()).filter(Boolean);
  const phone = completePhone(...values);
  return {phone: phone || values[0] || "", phoneMasked: !phone && values.length > 0, raw};
}

function serializeOrder(row: Record<string, unknown>, attempts: Record<string, unknown>[] = []) {
  const contact = sourcePhone(row);
  return {
    ...row,
    // Shiprocket has used both top-level and `others` contact fields across
    // report versions. Keep the stored value first, then accept every known
    // unmasked source; completePhone still rejects redacted values.
    customerPhone: contact.phone,
    phoneMasked: contact.phoneMasked,
    products: JSON.parse(String(row.productsJson || "[]")),
    productsJson: undefined,
    rawJson: undefined,
    tags: extractOrderTags(contact.raw),
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
  await ensureConfirmationSchema(runtime.DB);
  const url = new URL(request.url);
  const section = url.searchParams.get("section") || "confirmation";
  const requestedMode = url.searchParams.get("mode");
  const mode = requestedMode === "confirmed" || requestedMode === "rejected" ? requestedMode : "queue";
  const now = new Date().toISOString();
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? String(url.searchParams.get("from")) : "";
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") || "") ? String(url.searchParams.get("to")) : "";
  const agent = String(url.searchParams.get("agent") || "");
  const monthFilter = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? String(url.searchParams.get("month")) : "";
  const dateBasis = url.searchParams.get("dateBasis") === "allotted" ? "allotted" : "order";

  if (section === "delay_logs") {
    const orderId = Number(url.searchParams.get("orderId"));
    if (!orderId) return Response.json({ logs: [] });
    const logs = await runtime.DB.prepare(`
      SELECT id, order_id AS "orderId", channel_order_id AS "channelOrderId",
        reason_code AS "reasonCode", reason_text AS "reasonText", notes,
        hours_delayed AS "hoursDelayed", actor_id AS "actorId", actor_name AS "actorName",
        actor_role AS "actorRole", created_at AS "createdAt"
      FROM confirmation_delay_logs
      WHERE order_id = ?
      ORDER BY created_at DESC, id DESC
    `).bind(orderId).all<Record<string, unknown>>();
    return Response.json({ logs: logs.results });
  }

  if (section === "campaigns") {
    const [campaigns, candidates] = await Promise.all([
      runtime.DB.prepare(`SELECT c.id, c.name, c.description, c.criteria_json AS criteriaJson, c.position,
        c.is_active AS isActive, c.auto_assign AS autoAssign, COUNT(ca.order_id) AS orderCount
        FROM campaigns c LEFT JOIN campaign_assignments ca ON ca.campaign_id=c.id
        GROUP BY c.id ORDER BY c.position, c.created_at`).all<Record<string, unknown>>(),
      url.searchParams.get("candidates") === "true" ? runtime.DB.prepare(`SELECT ${candidateColumns}
        FROM orders o LEFT JOIN campaign_assignments ca ON ca.order_id=o.id LEFT JOIN campaigns c ON c.id=ca.campaign_id
        WHERE ${ACTIONABLE_STATUS_SQL} AND o.confirmation_status NOT IN ('confirmed','rejected')
        ORDER BY COALESCE(NULLIF(o.order_date,''),o.created_at) DESC`).all<Record<string, unknown>>() : Promise.resolve({results:[] as Record<string,unknown>[]}),
    ]);
    const serializedCandidates = candidates.results.map((row) => serializeCandidate(row));
    const availableTags = [...new Map(serializedCandidates.flatMap((order) => order.tags).map((tag) => [tag.trim().toLowerCase(), tag.trim()])).values()]
      .filter(Boolean).sort((left, right) => left.localeCompare(right));
    return Response.json({
      campaigns: campaigns.results.map((row) => ({ ...row, criteria: JSON.parse(String(row.criteriaJson || "{}")), criteriaJson: undefined })),
      ...(url.searchParams.get("candidates") === "true" ? {candidates: serializedCandidates,availableTags} : {}),
    });
  }

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(1000, Number(limitParam) || 400)) : 400;
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const filters: string[] = [];
  const filterValues: unknown[] = [];
  const fulfillment = url.searchParams.get("fulfillment") || "all";

  const dateCol = dateBasis === "allotted"
    ? "COALESCE(NULLIF(ca.created_at, ''), NULLIF(o.order_date, ''), o.created_at)"
    : "COALESCE(NULLIF(o.order_date, ''), o.created_at)";
  const dateColumn = `SUBSTR(${dateCol}, 1, 10)`;

  if (dateFrom) { filters.push(`${dateColumn} >= ?`); filterValues.push(dateFrom); }
  if (dateTo) { filters.push(`${dateColumn} <= ?`); filterValues.push(dateTo); }
  if (monthFilter) { filters.push(`SUBSTR(${dateColumn}, 1, 7) = ?`); filterValues.push(monthFilter); }
  if (agent === "unassigned") filters.push("o.confirmation_assignee_id='' ");
  else if (agent) { filters.push("o.confirmation_assignee_id=?"); filterValues.push(agent); }
  if (mode === "confirmed") {
    if (fulfillment === "pending") {
      filters.push("UPPER(TRIM(o.status)) IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING')");
    } else if (fulfillment === "shipped") {
      filters.push("UPPER(TRIM(o.status)) NOT IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING')");
    }
  }
  const extraWhere = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  const joins = "LEFT JOIN campaign_assignments ca ON ca.order_id=o.id LEFT JOIN campaigns c ON c.id=ca.campaign_id LEFT JOIN support_agents a ON a.user_id=o.confirmation_assignee_id";
  const queueCondition = `(o.confirmation_status IN ('pending','callback','unreachable') OR ((o.is_high_risk = TRUE OR ${HIGH_RISK_SQL}) AND o.confirmation_status NOT IN ('confirmed','rejected'))) AND ${ACTIONABLE_STATUS_SQL}`;

  const listQuery = mode === "confirmed"
    ? runtime.DB.prepare(`SELECT ${orderColumns}
      FROM orders o ${joins}
      WHERE o.confirmation_status='confirmed'${extraWhere} ORDER BY o.confirmed_at DESC, o.id DESC LIMIT ? OFFSET ?`).bind(...filterValues, limit, offset)
    : mode === "rejected"
      ? runtime.DB.prepare(`SELECT ${orderColumns}
        FROM orders o ${joins}
        WHERE o.confirmation_status='rejected'${extraWhere} ORDER BY o.rejected_at DESC, o.id DESC LIMIT ? OFFSET ?`).bind(...filterValues, limit, offset)
      : runtime.DB.prepare(`SELECT ${orderColumns}
      FROM orders o ${joins}
      WHERE ${queueCondition}
        AND NOT EXISTS (SELECT 1 FROM confirmation_attempts latest WHERE latest.order_id=o.id AND latest.next_action_at<>'' AND latest.next_action_at>?
          AND latest.id=(SELECT MAX(last_attempt.id) FROM confirmation_attempts last_attempt WHERE last_attempt.order_id=o.id))${extraWhere}
      ORDER BY COALESCE(NULLIF(o.order_date,''),o.created_at) DESC, o.id DESC LIMIT ? OFFSET ?`).bind(now, ...filterValues, limit, offset);

  const totalMatchingPromise = mode === "confirmed"
    ? runtime.DB.prepare(`SELECT COUNT(*) AS total FROM orders o ${joins} WHERE o.confirmation_status='confirmed'${extraWhere}`).bind(...filterValues).first<{ total: number }>()
    : mode === "rejected"
      ? runtime.DB.prepare(`SELECT COUNT(*) AS total FROM orders o ${joins} WHERE o.confirmation_status='rejected'${extraWhere}`).bind(...filterValues).first<{ total: number }>()
      : runtime.DB.prepare(`SELECT COUNT(*) AS total FROM orders o ${joins} WHERE ${queueCondition}
          AND NOT EXISTS (SELECT 1 FROM confirmation_attempts latest WHERE latest.order_id=o.id AND latest.next_action_at<>'' AND latest.next_action_at>?
            AND latest.id=(SELECT MAX(last_attempt.id) FROM confirmation_attempts last_attempt WHERE last_attempt.order_id=o.id))${extraWhere}`).bind(now, ...filterValues).first<{ total: number }>();

  const dateGroupsPromise = mode === "confirmed"
    ? runtime.DB.prepare(`SELECT ${dateColumn} AS date, COUNT(*)::int AS count
        FROM orders o ${joins} WHERE o.confirmation_status='confirmed' GROUP BY 1 ORDER BY 1 DESC LIMIT 120`).all<{date:string;count:number}>()
    : mode === "rejected"
      ? runtime.DB.prepare(`SELECT ${dateColumn} AS date, COUNT(*)::int AS count
          FROM orders o ${joins} WHERE o.confirmation_status='rejected' GROUP BY 1 ORDER BY 1 DESC LIMIT 120`).all<{date:string;count:number}>()
      : runtime.DB.prepare(`SELECT ${dateColumn} AS date, COUNT(*)::int AS count
          FROM orders o ${joins}
          WHERE ${queueCondition}
            AND NOT EXISTS (SELECT 1 FROM confirmation_attempts latest WHERE latest.order_id=o.id AND latest.next_action_at<>'' AND latest.next_action_at>?
              AND latest.id=(SELECT MAX(last_attempt.id) FROM confirmation_attempts last_attempt WHERE last_attempt.order_id=o.id))
          GROUP BY 1 ORDER BY 1 DESC LIMIT 120`).bind(now).all<{date:string;count:number}>();

  // Query confirmed orders sitting unfulfilled for > 24 hours after being confirmed
  const delayedOrdersPromise = runtime.DB.prepare(`
    SELECT o.id, o.channel_order_id AS "channelOrderId", o.customer_name AS "customerName",
      o.customer_phone AS "customerPhone", o.customer_city AS "customerCity", o.customer_state AS "customerState",
      o.total, o.status, o.confirmed_at AS "confirmedAt",
      COALESCE(o.delay_reason, '') AS "delayReason",
      COALESCE(o.delay_reason_updated_at, '') AS "delayReasonUpdatedAt"
    FROM orders o
    WHERE o.confirmation_status = 'confirmed'
      AND UPPER(TRIM(o.status)) IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING', 'CONFIRMED', 'READY TO SHIP', 'AWB ASSIGNED')
      AND (o.shipped_at IS NULL OR o.shipped_at = '')
      AND o.confirmed_at <> ''
      AND o.confirmed_at::timestamptz <= NOW() - INTERVAL '24 hours'
    ORDER BY o.confirmed_at ASC
    LIMIT 100
  `).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));

  const [orders, countRow, agents, dateGroups, totalMatchingRow, delayedOrdersRow] = await Promise.all([
    listQuery.all<Record<string, unknown>>(),
    runtime.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM orders o ${joins}
        WHERE ${queueCondition}
          AND NOT EXISTS (SELECT 1 FROM confirmation_attempts latest WHERE latest.order_id=o.id AND latest.next_action_at<>'' AND latest.next_action_at>?
            AND latest.id=(SELECT MAX(last_attempt.id) FROM confirmation_attempts last_attempt WHERE last_attempt.order_id=o.id))) AS queue,
      (SELECT COUNT(*) FROM orders WHERE confirmation_status='confirmed') AS confirmed,
      (SELECT COUNT(*) FROM orders WHERE confirmation_status='confirmed' AND UPPER(TRIM(status)) IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING')) AS confirmed_pending,
      (SELECT COUNT(*) FROM orders WHERE confirmation_status='confirmed' AND UPPER(TRIM(status)) NOT IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING')) AS confirmed_shipped,
      (SELECT COUNT(*) FROM orders WHERE confirmation_status='rejected') AS rejected`).bind(now).first<{ queue: number; confirmed: number; confirmed_pending: number; confirmed_shipped: number; rejected: number }>(),
    runtime.DB.prepare("SELECT user_id AS userId,name FROM support_agents WHERE available ORDER BY name").all<{userId:string;name:string}>().catch(() => ({results:[] as {userId:string;name:string}[]})),
    dateGroupsPromise.catch(() => ({ results: [] as {date:string;count:number}[] })),
    totalMatchingPromise.catch(() => ({ total: 0 })),
    delayedOrdersPromise,
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
    confirmedPending: Number(countRow?.confirmed_pending || 0),
    confirmedShipped: Number(countRow?.confirmed_shipped || 0),
    rejected: Number(countRow?.rejected || 0),
    approved: Number(countRow?.confirmed || 0),
  };

  const delayedOrders = delayedOrdersRow.results.map((r) => {
    const confirmedTime = Date.parse(String(r.confirmedAt || ""));
    const hoursDelayed = Number.isFinite(confirmedTime) ? Math.max(24, Math.round((Date.now() - confirmedTime) / 3600000)) : 24;
    const updatedAt = String(r.delayReasonUpdatedAt || "");
    const updatedTime = Date.parse(updatedAt);
    const requiresPrompt = !updatedAt || !Number.isFinite(updatedTime) || (Date.now() - updatedTime) >= 24 * 3600 * 1000;
    return {
      id: Number(r.id),
      channelOrderId: String(r.channelOrderId || ""),
      customerName: String(r.customerName || ""),
      customerPhone: String(r.customerPhone || ""),
      customerCity: String(r.customerCity || ""),
      customerState: String(r.customerState || ""),
      total: Number(r.total || 0),
      status: String(r.status || "NEW"),
      confirmedAt: String(r.confirmedAt || ""),
      hoursDelayed,
      delayReason: String(r.delayReason || ""),
      delayReasonUpdatedAt: updatedAt,
      requiresPrompt,
    };
  });

  const totalMatching = Number(totalMatchingRow?.total || 0);

  return Response.json({
    [mode]: serialized,
    counts,
    total: totalMatching,
    limit,
    offset,
    hasMore: totalMatching > offset + serialized.length,
    nextOffset: offset + serialized.length,
    delayedOrders,
    agents: agents.results,
    dateGroups: dateGroups.results,
  });
}

async function handlePOST(request: Request) {
  const access = await requireApiUser();
  if (access.response) return access.response;
  if (["support_agent","support_manager","warehouse"].includes(access.user.role)) return Response.json({error:"Order confirmation access required"},{status:403});
  if (!sameOrigin(request) || !isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const runtime = getRuntimeEnv();
  await ensureConfirmationSchema(runtime.DB);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
  const action = String(body.action || "");
  const now = new Date().toISOString();
  try {
    if (action === "log_delay_reason") {
      if (!isAdmin(access.user) && access.user.role !== "operations" && access.user.role !== "support_manager") {
        return Response.json({ error: "Administrator access required" }, { status: 403 });
      }
      const orderId = Number(body.orderId);
      const reasonCode = String(body.reasonCode || "").trim();
      const reasonText = String(body.reasonText || "").trim();
      const notes = String(body.notes || "").trim();
      if (!orderId) throw new Error("Order ID is required");
      if (!reasonCode) throw new Error("Delay reason category is required");
      if (!notes && !reasonText) throw new Error("Detailed notes explaining the delay are required");

      const order = await runtime.DB.prepare(`
        SELECT id, channel_order_id AS "channelOrderId", status, confirmed_at AS "confirmedAt"
        FROM orders WHERE id=?
      `).bind(orderId).first<{ id: number; channelOrderId: string; status: string; confirmedAt: string }>();
      if (!order) throw new Error("Order was not found");

      const confirmedTime = Date.parse(order.confirmedAt || "");
      const hoursDelayed = Number.isFinite(confirmedTime) ? Math.max(24, Math.round((Date.now() - confirmedTime) / 3600000)) : 24;
      const summaryText = reasonText || reasonCode.replace(/_/g, " ");

      await runtime.DB.batch([
        runtime.DB.prepare(`
          INSERT INTO confirmation_delay_logs
            (order_id, channel_order_id, reason_code, reason_text, notes, hours_delayed, actor_id, actor_name, actor_role, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(orderId, order.channelOrderId, reasonCode, summaryText, notes, hoursDelayed, access.user.id, access.user.name, access.user.role, now),
        runtime.DB.prepare(`
          UPDATE orders SET delay_reason=?, delay_reason_updated_at=? WHERE id=?
        `).bind(`${summaryText}${notes ? `: ${notes}` : ""}`, now, orderId),
        runtime.DB.prepare(`
          INSERT INTO activity_logs (source, event_type, level, message, details_json, created_at, actor_id, actor_name, actor_role)
          VALUES ('confirmation', 'order.delay_reason', 'warning', ?, ?, ?, ?, ?, ?)
        `).bind(
          `Delay reason logged for order #${order.channelOrderId} (${hoursDelayed}h unfulfilled): ${summaryText}`,
          JSON.stringify({
            orderId,
            channelOrderId: order.channelOrderId,
            reasonCode,
            summaryText,
            notes,
            hoursDelayed,
            actorId: access.user.id,
            actorName: access.user.name,
            actorRole: access.user.role,
          }),
          now, access.user.id, access.user.name, access.user.role
        ),
      ]);
      return Response.json({ ok: true, orderId, delayReason: `${summaryText}${notes ? `: ${notes}` : ""}`, delayReasonUpdatedAt: now });
    }
    if (action === "assign_confirmation_agent") {
      if (!isAdmin(access.user)) return Response.json({error:"Administrator access required"},{status:403});
      const orderId = Number(body.orderId);
      const agentId = String(body.agentId || "");
      if (!orderId) throw new Error("Order is required");
      if (agentId) {
        const agent = await runtime.DB.prepare("SELECT user_id FROM support_agents WHERE user_id=? AND available").bind(agentId).first();
        if (!agent) throw new Error("Select an available agent");
      }
      await runtime.DB.prepare("UPDATE orders SET confirmation_assignee_id=?,confirmation_updated_at=? WHERE id=?").bind(agentId, now, orderId).run();
      return Response.json({ok:true});
    }
    if (action === "refresh_contacts") {
      const after = Math.max(0, Number(body.after) || 0);
      const rows = await runtime.DB.prepare(`SELECT id,channel_order_id AS "channelOrderId",customer_phone AS "customerPhone" FROM orders WHERE id>? AND LOWER(channel_name) LIKE '%shopify%' ORDER BY id LIMIT 50`).bind(after).all<{id:number;channelOrderId:string;customerPhone:string}>();
      const contacts = await shopifyOrderContacts(runtime, rows.results.map(row => row.channelOrderId));
      const updates = rows.results.flatMap(row => {
        const contact = contacts.get(row.channelOrderId.replace(/^#/, ""));
        if (!contact) return [];
        const phone = completePhone(contact.shippingAddress?.phone, contact.phone, contact.billingAddress?.phone, row.customerPhone);
        return [runtime.DB.prepare(`UPDATE orders SET customer_phone=?, raw_json=(raw_json::jsonb || jsonb_build_object('shopify_tags',?::jsonb))::text WHERE id=?`).bind(phone,JSON.stringify(contact.tags),row.id)];
      });
      if(updates.length) await runtime.DB.batch(updates);
      return Response.json({ok:true, updated:updates.length, next:rows.results.length===50 ? rows.results.at(-1)?.id : null});
    }
    if (action === "reveal_phone") {
      const orderId = Number(body.orderId);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new Error("Order is required");
      const order = await runtime.DB.prepare(`SELECT id,channel_order_id AS "channelOrderId",customer_phone AS "customerPhone",raw_json AS "rawJson",channel_name AS "channelName" FROM orders WHERE id=?`).bind(orderId).first<Record<string, unknown>>();
      if (!order) return Response.json({error:"Order not found"},{status:404});
      let phone = sourcePhone(order).phone;
      if (String(order.channelName || "").toLowerCase().includes("shopify")) {
        const contact = (await shopifyOrderContacts(runtime, [String(order.channelOrderId)])).get(String(order.channelOrderId).replace(/^#/, ""));
        const resolved = contact && completePhone(contact.shippingAddress?.phone, contact.phone, contact.billingAddress?.phone);
        if (resolved) {
          phone = resolved;
          await runtime.DB.prepare("UPDATE orders SET customer_phone=?,raw_json=(raw_json::jsonb || jsonb_build_object('shopify_tags',?::jsonb))::text WHERE id=?").bind(phone, JSON.stringify(contact.tags), orderId).run();
        }
      }
      return Response.json({customerPhone:phone,phoneMasked:!completePhone(phone) && Boolean(phone)});
    }
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
      statements.push(runtime.DB.prepare("INSERT INTO activity_logs (source,event_type,level,message,details_json,created_at,actor_id,actor_name,actor_role) VALUES ('confirmation','campaign.created','info',?,?,?,?,?,?)").bind(`Campaign ${name} created`, JSON.stringify({ campaignId, orderCount: orderIds.length, autoAssign, actorId: access.user.id, actorName: access.user.name, actorRole: access.user.role }), now, access.user.id, access.user.name, access.user.role));
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
      runtime.DB.prepare("INSERT INTO activity_logs (source,event_type,level,message,details_json,created_at,actor_id,actor_name,actor_role) VALUES ('confirmation',?,'info',?,?,?,?,?,?)")
        .bind(`order.${outcome}`, `Order ${order.channelOrderId} marked ${outcome}`, JSON.stringify({ orderId, note, rejectionReason: reason, nextActionAt, actorId: access.user.id, actorName: access.user.name, actorRole: access.user.role }), now, access.user.id, access.user.name, access.user.role),
    ]);
    return Response.json({ ok: true, status: outcome });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Confirmation action failed" }, { status: 422 });
  }
}

export async function GET(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }

export async function POST(...args: Parameters<typeof handlePOST>) { try { return await handlePOST(...args); } catch (error) { return errorResponse(error); } }
