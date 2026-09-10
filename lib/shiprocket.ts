import { ensureSchema, logActivity, setSyncState, type PostgresDatabase, type RuntimeEnv } from "./database";
import { routeConfirmationOrders } from "./confirmation";

const API_ROOT = "https://apiv2.shiprocket.in/v1/external";
type ShiprocketOrder = Record<string, unknown> & { id?: number; shipments?: Array<Record<string, unknown>> | Record<string, unknown>; products?: Array<Record<string, unknown>> };
type ShiprocketNdr = Record<string, unknown> & { id?: number; shipment_id?: number; awb_code?: string };
type SyncMode = "full" | "incremental";
type SyncChange = { orderId: number; channelOrderId: string; fields: string[]; statusBefore?: string; statusAfter?: string };
export type SyncReport = {
  mode: SyncMode; checked: number; newOrders: number; changedOrders: number; unchangedOrders: number;
  discrepanciesTotal: number; ndrRecords: number; ndrEnriched: number;
  fields: Record<string, number>; changes: SyncChange[]; completedAt?: string;
};

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function apiJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      ? String((payload as { message: unknown }).message)
      : `Shiprocket request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function getShiprocketToken(runtime: RuntimeEnv) {
  const now = Date.now();
  const cached = await runtime.DB.prepare("SELECT key, value FROM sync_state WHERE key IN ('shiprocket_token', 'shiprocket_token_expires_at', 'shiprocket_auth_retry_after', 'shiprocket_backup_attempted')").all<{ key: string; value: string }>();
  const authState = Object.fromEntries(cached.results.map((row) => [row.key, row.value]));
  const expiresAt = Date.parse(authState.shiprocket_token_expires_at || "");
  if (authState.shiprocket_token && Number.isFinite(expiresAt) && expiresAt > now + 60 * 60 * 1000) {
    return authState.shiprocket_token;
  }
  const retryAfter = Date.parse(authState.shiprocket_auth_retry_after || "");
  const backupConfigured = Boolean(runtime.SHIPROCKET_BACKUP_EMAIL && runtime.SHIPROCKET_BACKUP_PASSWORD);
  if (Number.isFinite(retryAfter) && retryAfter > now && (!backupConfigured || authState.shiprocket_backup_attempted === "true")) {
    throw new Error(`Shiprocket temporarily blocked token generation. The dashboard will not retry before ${new Date(retryAfter).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}.`);
  }

  const credentials = [
    { email: required(runtime.SHIPROCKET_EMAIL, "SHIPROCKET_EMAIL"), password: required(runtime.SHIPROCKET_PASSWORD, "SHIPROCKET_PASSWORD"), source: "primary" },
    ...(runtime.SHIPROCKET_BACKUP_EMAIL && runtime.SHIPROCKET_BACKUP_PASSWORD
      ? [{ email: runtime.SHIPROCKET_BACKUP_EMAIL, password: runtime.SHIPROCKET_BACKUP_PASSWORD, source: "backup" }]
      : []),
  ];
  let lastError: unknown;
  for (const credential of credentials) {
    try {
      const result = await apiJson<{ token: string }>(`${API_ROOT}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: credential.email, password: credential.password }),
      });
      const token = required(result.token, "Shiprocket token");
      await setSyncState(runtime.DB, "shiprocket_token", token);
      await setSyncState(runtime.DB, "shiprocket_token_expires_at", new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString());
      await setSyncState(runtime.DB, "shiprocket_auth_retry_after", "");
      await setSyncState(runtime.DB, "shiprocket_backup_attempted", "false");
      await setSyncState(runtime.DB, "shiprocket_auth_source", credential.source);
      return token;
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : "Shiprocket authentication failed";
  if (/blocked|too many failed login/i.test(message)) {
    await setSyncState(runtime.DB, "shiprocket_auth_retry_after", new Date(now + 30 * 60 * 1000).toISOString());
    await setSyncState(runtime.DB, "shiprocket_backup_attempted", backupConfigured ? "true" : "false");
    throw new Error("Shiprocket temporarily blocked token generation after repeated login requests. No further login attempts will be made for 30 minutes.");
  }
  throw lastError;
}

function expectedChannelNames(value: string) {
  const names = new Set([value.trim().toLowerCase()]);
  const bracketed = value.match(/\(([^)]+)\)/)?.[1];
  if (bracketed) names.add(bracketed.trim().toLowerCase());
  return names;
}

export async function resolveChannel(runtime: RuntimeEnv, token: string) {
  if (runtime.SHIPROCKET_CHANNEL_ID) return { id: Number(runtime.SHIPROCKET_CHANNEL_ID), name: runtime.SHIPROCKET_CHANNEL_NAME || "Shopify_5" };
  const result = await apiJson<{ data?: Array<{ id: number; name: string; status?: string }> }>(
    `${API_ROOT}/channels`,
    { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
  );
  const expected = expectedChannelNames(runtime.SHIPROCKET_CHANNEL_NAME || "Satmi (Shopify_5)");
  const channel = (result.data || []).find((item) => expected.has(item.name.trim().toLowerCase()));
  if (!channel) throw new Error(`Shiprocket channel “${runtime.SHIPROCKET_CHANNEL_NAME || "Satmi (Shopify_5)"}” was not found`);
  return channel;
}

const stringValue = (value: unknown) => value == null ? "" : String(value);
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const monthNumbers: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function normalizeShiprocketDate(value: unknown) {
  const source = stringValue(value).trim();
  if (!source) return "";
  const named = source.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (named) {
    const [, day, monthName, year, rawHour, minute, second = "00", meridiem] = named;
    let hour = Number(rawHour) % 12;
    if (meridiem.toUpperCase() === "PM") hour += 12;
    const month = monthNumbers[monthName.toLowerCase()];
    return `${year}-${month}-${day.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}:${second}+05:30`;
  }
  const named24Hour = source.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/i);
  if (named24Hour) {
    const [, day, monthName, year, hour, minute, second = "00"] = named24Hour;
    return `${year}-${monthNumbers[monthName.toLowerCase()]}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}+05:30`;
  }
  const namedDate = source.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})\s+(\d{4})$/i);
  if (namedDate) {
    const [, day, monthName, year] = namedDate;
    return `${year}-${monthNumbers[monthName.toLowerCase()]}-${day.padStart(2, "0")}T00:00:00+05:30`;
  }
  const dayFirst = source.match(/^(\d{2})[ -](\d{2})[ -](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dayFirst) {
    const [, day, month, year, hour = "00", minute = "00", second = "00"] = dayFirst;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`;
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(source)) {
    const normalized = source.replace(" ", "T");
    return /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+05:30`;
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? source : parsed.toISOString();
}

function shipmentFor(order: ShiprocketOrder) {
  return Array.isArray(order.shipments)
    ? order.shipments[0] || {}
    : order.shipments && typeof order.shipments === "object" ? order.shipments : {};
}

function orderSnapshot(order: ShiprocketOrder) {
  const shipment = shipmentFor(order);
  const others = order.others && typeof order.others === "object" ? order.others as Record<string, unknown> : {};
  const status = stringValue(order.status || shipment.status || shipment.shipment_status);
  const deliveredAt = normalizeShiprocketDate(
    order.delivered_date || shipment.delivered_date || (/^DELIVERED(?: TO CUSTOMER)?$/i.test(status) ? order.updated_at || shipment.updated_at : ""),
  );
  return {
    id: numberValue(order.id), channelOrderId: stringValue(order.channel_order_id), channelId: numberValue(order.channel_id),
    channelName: stringValue(order.channel_name), customerName: stringValue(order.customer_name),
    customerEmail: stringValue(order.customer_email), customerPhone: stringValue(order.customer_phone_unmasked || others.billing_phone_number || order.customer_phone || others.billing_phone),
    customerCity: stringValue(order.customer_city || order.billing_city || order.shipping_city),
    customerState: stringValue(order.customer_state || order.billing_state || order.shipping_state),
    orderDate: normalizeShiprocketDate(order.channel_created_at || order.order_date || order.created_at),
    createdAt: normalizeShiprocketDate(order.created_at), updatedAt: normalizeShiprocketDate(order.updated_at),
    deliveredAt,
    shippedAt: normalizeShiprocketDate(shipment.shipped_date || order.picked_up_date),
    outForDeliveryAt: normalizeShiprocketDate(order.out_for_delivery_date || shipment.out_for_delivery_date || (/^OUT FOR DELIVERY$/i.test(status) ? order.updated_at || shipment.updated_at : "")),
    firstOutForDeliveryAt: normalizeShiprocketDate(order.first_out_for_delivery_date),
    status, statusCode: numberValue(order.status_code || shipment.status_code) || null,
    paymentMethod: stringValue(order.payment_method), paymentStatus: stringValue(order.payment_status),
    total: numberValue(order.total),
    shippingCost: numberValue(shipment.shipping_charges || shipment.cost || order.shipping_charges || order.freight_charges),
    pickupLocation: stringValue(order.pickup_location), awb: stringValue(shipment.awb),
    courier: stringValue(shipment.courier || shipment.courier_name),
    shipmentId: numberValue(shipment.id || shipment.shipment_id) || null,
    productsJson: JSON.stringify(Array.isArray(order.products) ? order.products : []), rawJson: JSON.stringify(order),
  };
}

function addField(report: SyncReport, field: string) {
  report.fields[field] = (report.fields[field] || 0) + 1;
  report.discrepanciesTotal += 1;
}

async function analyzeOrders(db: PostgresDatabase, orders: ShiprocketOrder[], report: SyncReport) {
  const snapshots = orders.map(orderSnapshot).filter((order) => order.id);
  if (!snapshots.length) return;
  const existing = await db.prepare(`
    SELECT id, channel_order_id AS channelOrderId, status, awb, courier,
      payment_method AS paymentMethod, total, customer_state AS customerState,
      order_date AS orderDate, delivered_at AS deliveredAt, shipped_at AS shippedAt,
      out_for_delivery_at AS outForDeliveryAt, first_out_for_delivery_at AS firstOutForDeliveryAt,
      shipping_cost AS shippingCost
    FROM orders WHERE id IN (${snapshots.map(() => "?").join(",")})
  `).bind(...snapshots.map((order) => order.id)).all<Record<string, unknown>>();
  const byId = new Map(existing.results.map((order) => [Number(order.id), order]));
  for (const snapshot of snapshots) {
    report.checked += 1;
    const current = byId.get(snapshot.id);
    if (!current) { report.newOrders += 1; continue; }
    const changed: string[] = [];
    const compare = (field: string, incoming: unknown, stored: unknown, optional = false) => {
      if (optional && (incoming === "" || incoming === 0 || incoming == null)) return;
      if (String(incoming ?? "") !== String(stored ?? "")) { changed.push(field); addField(report, field); }
    };
    compare("status", snapshot.status, current.status);
    compare("AWB", snapshot.awb, current.awb);
    compare("courier", snapshot.courier, current.courier);
    compare("payment", snapshot.paymentMethod, current.paymentMethod);
    compare("amount", snapshot.total, current.total);
    compare("state", snapshot.customerState, current.customerState);
    compare("order date", snapshot.orderDate, current.orderDate);
    compare("shipped date", snapshot.shippedAt, current.shippedAt, true);
    compare("OFD date", snapshot.outForDeliveryAt, current.outForDeliveryAt, true);
    compare("first OFD date", snapshot.firstOutForDeliveryAt, current.firstOutForDeliveryAt, true);
    compare("delivered date", snapshot.deliveredAt, current.deliveredAt, true);
    compare("shipping cost", snapshot.shippingCost, current.shippingCost, true);
    if (changed.length) {
      report.changedOrders += 1;
      if (report.changes.length < 100) report.changes.push({
        orderId: snapshot.id, channelOrderId: snapshot.channelOrderId, fields: changed,
        ...(changed.includes("status") ? { statusBefore: String(current.status || ""), statusAfter: snapshot.status } : {}),
      });
    } else report.unchangedOrders += 1;
  }
}

export async function upsertOrders(db: PostgresDatabase, orders: ShiprocketOrder[]) {
  const syncedAt = new Date().toISOString();
  for (let start = 0; start < orders.length; start += 100) {
    const statements = orders.slice(start, start + 100).map((order) => {
      const value = orderSnapshot(order);
      if (!value.id) throw new Error("Shiprocket returned an order without an id");
      return db.prepare(`
        INSERT INTO orders (
          id, channel_order_id, channel_id, channel_name, customer_name, customer_email,
          customer_phone, customer_city, customer_state, order_date, created_at, updated_at, delivered_at,
          shipped_at, out_for_delivery_at, first_out_for_delivery_at,
          status, status_code, payment_method, payment_status, total, shipping_cost, pickup_location,
          awb, courier, shipment_id, products_json, raw_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          channel_order_id=excluded.channel_order_id, channel_id=excluded.channel_id,
          channel_name=excluded.channel_name, customer_name=excluded.customer_name,
          customer_email=excluded.customer_email, customer_phone=excluded.customer_phone,
          customer_city=excluded.customer_city, customer_state=excluded.customer_state,
          order_date=excluded.order_date, created_at=excluded.created_at, updated_at=excluded.updated_at,
          delivered_at=COALESCE(NULLIF(excluded.delivered_at, ''), orders.delivered_at),
          shipped_at=COALESCE(NULLIF(excluded.shipped_at, ''), orders.shipped_at),
          out_for_delivery_at=CASE
            WHEN excluded.out_for_delivery_at = '' THEN orders.out_for_delivery_at
            WHEN orders.out_for_delivery_at = '' THEN excluded.out_for_delivery_at
            WHEN excluded.out_for_delivery_at ~ '^\\d{4}-\\d{2}-\\d{2}T' AND orders.out_for_delivery_at ~ '^\\d{4}-\\d{2}-\\d{2}T'
              THEN CASE WHEN excluded.out_for_delivery_at::timestamptz > orders.out_for_delivery_at::timestamptz THEN excluded.out_for_delivery_at ELSE orders.out_for_delivery_at END
            ELSE GREATEST(excluded.out_for_delivery_at, orders.out_for_delivery_at)
          END,
          first_out_for_delivery_at=CASE
            WHEN excluded.first_out_for_delivery_at = '' THEN orders.first_out_for_delivery_at
            WHEN orders.first_out_for_delivery_at = '' THEN excluded.first_out_for_delivery_at
            WHEN excluded.first_out_for_delivery_at ~ '^\\d{4}-\\d{2}-\\d{2}T' AND orders.first_out_for_delivery_at ~ '^\\d{4}-\\d{2}-\\d{2}T'
              THEN CASE WHEN excluded.first_out_for_delivery_at::timestamptz < orders.first_out_for_delivery_at::timestamptz THEN excluded.first_out_for_delivery_at ELSE orders.first_out_for_delivery_at END
            ELSE LEAST(excluded.first_out_for_delivery_at, orders.first_out_for_delivery_at)
          END,
          status=excluded.status, status_code=excluded.status_code,
          payment_method=excluded.payment_method, payment_status=excluded.payment_status,
          total=excluded.total, shipping_cost=CASE WHEN excluded.shipping_cost > 0 THEN excluded.shipping_cost ELSE orders.shipping_cost END,
          pickup_location=excluded.pickup_location, awb=excluded.awb,
          courier=excluded.courier, shipment_id=excluded.shipment_id,
          products_json=excluded.products_json, raw_json=excluded.raw_json, synced_at=excluded.synced_at
      `).bind(
        value.id, value.channelOrderId, value.channelId, value.channelName, value.customerName,
        value.customerEmail, value.customerPhone, value.customerCity, value.customerState,
        value.orderDate, value.createdAt, value.updatedAt, value.deliveredAt, value.shippedAt,
        value.outForDeliveryAt, value.firstOutForDeliveryAt, value.status, value.statusCode,
        value.paymentMethod, value.paymentStatus, value.total, value.shippingCost, value.pickupLocation,
        value.awb, value.courier, value.shipmentId, value.productsJson, value.rawJson, syncedAt,
      );
    });
    if (statements.length) await db.batch(statements);
    await routeConfirmationOrders(db, orders.slice(start, start + 100).map((order) => numberValue(order.id)));
  }
}

async function syncNdrDetails(db: PostgresDatabase, token: string, channelId: number, report: SyncReport) {
  const fetchPage = (page: number) => apiJson<{ data?: ShiprocketNdr[]; meta?: { pagination?: { total_pages?: number } } }>(
    `${API_ROOT}/ndr/all?per_page=100&page=${page}`,
    { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
  );
  const firstPage = await fetchPage(1);
  const totalPages = Math.min(Number(firstPage.meta?.pagination?.total_pages || 1), 25);
  const records = [...(firstPage.data || [])];
  for (let start = 2; start <= totalPages; start += 4) {
    const pageNumbers = Array.from({ length: Math.min(4, totalPages - start + 1) }, (_, index) => start + index);
    const pages = await Promise.all(pageNumbers.map(fetchPage));
    for (const page of pages) records.push(...(page.data || []));
  }
  const channelRecords = records.filter((record) => !record.shipment_channel_id || Number(record.shipment_channel_id) === channelId);
  report.ndrRecords += channelRecords.length;
  const ids = [...new Set(channelRecords.map((record) => numberValue(record.id)).filter(Boolean))];
  const existing = ids.length ? await db.prepare(`
    SELECT id, ndr_reason AS reason, ndr_attempts AS attempts, ndr_raised_at AS raisedAt
    FROM orders WHERE id IN (${ids.map(() => "?").join(",")})
  `).bind(...ids).all<{ id: number; reason: string; attempts: number; raisedAt: string }>() : { results: [] };
  const existingById = new Map(existing.results.map((order) => [Number(order.id), order]));
  for (let start = 0; start < channelRecords.length; start += 100) {
    const statements = [];
    for (const record of channelRecords.slice(start, start + 100)) {
      const id = numberValue(record.id);
      const current = existingById.get(id);
      if (!current) continue;
      const reason = stringValue(record.reason || record.ndr_reason || record.cancellation_reason);
      const attempts = numberValue(record.attempts);
      const raisedAt = normalizeShiprocketDate(record.ndr_raised_at);
      const fields: string[] = [];
      if (reason && reason !== current.reason) { fields.push("NDR reason"); addField(report, "NDR reason"); }
      if (attempts && attempts !== Number(current.attempts || 0)) { fields.push("NDR attempts"); addField(report, "NDR attempts"); }
      if (raisedAt && raisedAt !== current.raisedAt) { fields.push("NDR raised date"); addField(report, "NDR raised date"); }
      if (fields.length) {
        report.ndrEnriched += 1;
        if (report.changes.length < 100) report.changes.push({ orderId: current.id, channelOrderId: stringValue(record.channel_order_id), fields });
      }
      statements.push(db.prepare(`
        UPDATE orders SET ndr_reason = COALESCE(NULLIF(?, ''), ndr_reason),
          ndr_attempts = CASE WHEN ? > 0 THEN ? ELSE ndr_attempts END,
          ndr_raised_at = COALESCE(NULLIF(?, ''), ndr_raised_at), ndr_json = ?
        WHERE id = ?
      `).bind(reason, attempts, attempts, raisedAt, JSON.stringify(record), current.id));
    }
    if (statements.length) await db.batch(statements);
  }
}

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

export async function syncShiprocketOrders(
  runtime: RuntimeEnv,
  mode: SyncMode = "incremental",
  source = "manual",
  options: { startPage?: number; maxPages?: number } = {},
) {
  const db = runtime.DB;
  if (!db) throw new Error("Database binding is unavailable");
  await ensureSchema(db);
  const syncRows = await db.prepare("SELECT key, value FROM sync_state WHERE key IN ('initial_sync_completed_at', 'full_sync_next_page')").all<{ key: string; value: string }>();
  const syncState = Object.fromEntries(syncRows.results.map((row) => [row.key, row.value]));
  const effectiveMode: SyncMode = mode === "incremental" && !syncState.initial_sync_completed_at ? "full" : mode;
  const storedPage = Math.max(1, Number(syncState.full_sync_next_page || 1));
  const startPage = effectiveMode === "full" ? Math.max(1, Number(options.startPage || storedPage)) : 1;
  const maxPages = effectiveMode === "full" ? Math.min(10, Math.max(1, Number(options.maxPages || 4))) : 500;
  await logActivity(db, source, "sync.started", `${effectiveMode === "full" ? "Full" : "Incremental"} Shiprocket sync started`, { mode: effectiveMode });
  await setSyncState(db, "sync_status", "running");
  await setSyncState(db, "last_sync_started_at", new Date().toISOString());
  try {
    const token = await getShiprocketToken(runtime);
    const channel = await resolveChannel(runtime, token);
    const report: SyncReport = { mode: effectiveMode, checked: 0, newOrders: 0, changedOrders: 0, unchangedOrders: 0, discrepanciesTotal: 0, ndrRecords: 0, ndrEnriched: 0, fields: {}, changes: [] };
    const fetchPage = (page: number) => {
      const params = new URLSearchParams({ page: String(page), per_page: "100", sort: "DESC", sort_by: "id", channel_id: String(channel.id) });
      if (effectiveMode === "incremental") {
        const from = new Date();
        from.setUTCDate(from.getUTCDate() - 2);
        const through = new Date();
        through.setUTCDate(through.getUTCDate() + 1);
        params.set("updated_from", dateOnly(from));
        // Shiprocket treats a date-only upper bound as midnight at the start of that date.
        // Using tomorrow keeps every order created or updated today inside the window.
        params.set("updated_to", dateOnly(through));
      }
      return apiJson<{ data?: ShiprocketOrder[]; meta?: { pagination?: { total_pages?: number } } }>(
        `${API_ROOT}/orders?${params.toString()}`,
        { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
      );
    };
    const firstPage = await fetchPage(startPage);
    const totalPages = Math.min(Number(firstPage.meta?.pagination?.total_pages || 1), 500);
    const orders = [...(firstPage.data || [])];
    const endPage = Math.min(totalPages, startPage + maxPages - 1);
    for (let start = startPage + 1; start <= endPage; start += 4) {
      const pageNumbers = Array.from({ length: Math.min(4, endPage - start + 1) }, (_, index) => start + index);
      const pages = await Promise.all(pageNumbers.map(fetchPage));
      for (const page of pages) orders.push(...(page.data || []));
    }
    for (let start = 0; start < orders.length; start += 100) {
      const batch = orders.slice(start, start + 100);
      await analyzeOrders(db, batch, report);
      await upsertOrders(db, batch);
    }
    const synced = orders.length;
    const hasMore = effectiveMode === "full" && endPage < totalPages;
    if (hasMore) {
      const nextPage = endPage + 1;
      await setSyncState(db, "full_sync_next_page", String(nextPage));
      await setSyncState(db, "last_sync_count", String(synced));
      await logActivity(db, source, "sync.chunk_completed", `Imported Shiprocket pages ${startPage}-${endPage} of ${totalPages}`, {
        synced, startPage, endPage, totalPages, nextPage,
      });
      return { synced, channelId: channel.id, channelName: channel.name, mode: effectiveMode, report, hasMore, nextPage, totalPages };
    }
    await syncNdrDetails(db, token, channel.id, report);
    const completedAt = new Date().toISOString();
    report.completedAt = completedAt;
    await setSyncState(db, "channel_id", String(channel.id));
    await setSyncState(db, "channel_name", channel.name);
    await setSyncState(db, "last_sync_at", completedAt);
    await setSyncState(db, "last_sync_mode", effectiveMode);
    await setSyncState(db, "last_sync_count", String(synced));
    await setSyncState(db, "last_sync_report_json", JSON.stringify(report));
    await db.prepare(`
      INSERT INTO sync_reports (
        mode, source, checked, new_orders, changed_orders, unchanged_orders,
        discrepancies_total, ndr_records, ndr_enriched, fields_json, changes_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      report.mode, source, report.checked, report.newOrders, report.changedOrders,
      report.unchangedOrders, report.discrepanciesTotal, report.ndrRecords,
      report.ndrEnriched, JSON.stringify(report.fields), JSON.stringify(report.changes), completedAt,
    ).run();
    await setSyncState(db, "sync_status", "healthy");
    await setSyncState(db, "last_sync_error", "");
    if (effectiveMode === "full") {
      await setSyncState(db, "initial_sync_completed_at", completedAt);
      await setSyncState(db, "full_sync_next_page", "");
    }
    await logActivity(db, source, "sync.completed", `Verified ${synced} orders · ${report.discrepanciesTotal} field discrepancies repaired`, {
      synced, channelId: channel.id, channelName: channel.name, mode: effectiveMode, report,
    });
    return { synced, channelId: channel.id, channelName: channel.name, completedAt, mode: effectiveMode, report, hasMore: false, totalPages };
  } catch (error) {
    await setSyncState(db, "sync_status", "error");
    await setSyncState(db, "last_sync_error", error instanceof Error ? error.message : "Unknown sync error");
    await logActivity(db, source, "sync.failed", "Shiprocket sync failed", {
      mode: effectiveMode, error: error instanceof Error ? error.message : "Unknown sync error",
    }, "error");
    throw error;
  }
}

export async function fetchSpecificOrder(runtime: RuntimeEnv, shiprocketOrderId: number) {
  const token = await getShiprocketToken(runtime);
  const result = await apiJson<{ data?: ShiprocketOrder }>(
    `${API_ROOT}/orders/show/${shiprocketOrderId}`,
    { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
  );
  if (result.data) await upsertOrders(runtime.DB, [result.data]);
  return result.data;
}
