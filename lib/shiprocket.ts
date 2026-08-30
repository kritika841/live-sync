import { ensureSchema, logActivity, setSyncState, type RuntimeEnv } from "./database";

const API_ROOT = "https://apiv2.shiprocket.in/v1/external";
type ShiprocketOrder = Record<string, unknown> & { id?: number; shipments?: Array<Record<string, unknown>> | Record<string, unknown>; products?: Array<Record<string, unknown>> };
type SyncMode = "full" | "incremental";

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
  const namedDate = source.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})\s+(\d{4})$/i);
  if (namedDate) {
    const [, day, monthName, year] = namedDate;
    return `${year}-${monthNumbers[monthName.toLowerCase()]}-${day.padStart(2, "0")}T00:00:00+05:30`;
  }
  const dayFirst = source.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
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

export async function upsertOrders(db: D1Database, orders: ShiprocketOrder[]) {
  const syncedAt = new Date().toISOString();
  for (let start = 0; start < orders.length; start += 25) {
    const statements = orders.slice(start, start + 25).map((order) => {
      const shipment = Array.isArray(order.shipments)
        ? order.shipments[0] || {}
        : order.shipments && typeof order.shipments === "object" ? order.shipments : {};
      const orderId = numberValue(order.id);
      if (!orderId) throw new Error("Shiprocket returned an order without an id");
      const status = stringValue(order.status || shipment.status || shipment.shipment_status);
      const deliveredAt = normalizeShiprocketDate(
        order.delivered_date || shipment.delivered_date || (/^DELIVERED(?: TO CUSTOMER)?$/i.test(status) ? order.updated_at || shipment.updated_at : ""),
      );
      const outForDeliveryAt = normalizeShiprocketDate(
        order.out_for_delivery_date || shipment.out_for_delivery_date || (/^OUT FOR DELIVERY$/i.test(status) ? order.updated_at || shipment.updated_at : ""),
      );
      return db.prepare(`
        INSERT INTO orders (
          id, channel_order_id, channel_id, channel_name, customer_name, customer_email,
          customer_phone, customer_city, customer_state, order_date, created_at, updated_at, delivered_at, out_for_delivery_at,
          status, status_code, payment_method, payment_status, total, pickup_location,
          awb, courier, shipment_id, products_json, raw_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          channel_order_id=excluded.channel_order_id, channel_id=excluded.channel_id,
          channel_name=excluded.channel_name, customer_name=excluded.customer_name,
          customer_email=excluded.customer_email, customer_phone=excluded.customer_phone,
          customer_city=excluded.customer_city, customer_state=excluded.customer_state,
          order_date=excluded.order_date, created_at=excluded.created_at, updated_at=excluded.updated_at,
          delivered_at=COALESCE(NULLIF(excluded.delivered_at, ''), orders.delivered_at),
          out_for_delivery_at=COALESCE(NULLIF(excluded.out_for_delivery_at, ''), orders.out_for_delivery_at),
          status=excluded.status, status_code=excluded.status_code,
          payment_method=excluded.payment_method, payment_status=excluded.payment_status,
          total=excluded.total, pickup_location=excluded.pickup_location, awb=excluded.awb,
          courier=excluded.courier, shipment_id=excluded.shipment_id,
          products_json=excluded.products_json, raw_json=excluded.raw_json, synced_at=excluded.synced_at
      `).bind(
        orderId, stringValue(order.channel_order_id), numberValue(order.channel_id),
        stringValue(order.channel_name), stringValue(order.customer_name),
        stringValue(order.customer_email), stringValue(order.customer_phone),
        stringValue(order.customer_city || order.billing_city || order.shipping_city),
        stringValue(order.customer_state || order.billing_state || order.shipping_state),
        normalizeShiprocketDate(order.channel_created_at || order.order_date || order.created_at),
        normalizeShiprocketDate(order.created_at), normalizeShiprocketDate(order.updated_at), deliveredAt, outForDeliveryAt, status,
        numberValue(order.status_code || shipment.status_code) || null,
        stringValue(order.payment_method), stringValue(order.payment_status), numberValue(order.total),
        stringValue(order.pickup_location), stringValue(shipment.awb),
        stringValue(shipment.courier || shipment.courier_name),
        numberValue(shipment.id || shipment.shipment_id) || null,
        JSON.stringify(Array.isArray(order.products) ? order.products : []),
        JSON.stringify(order), syncedAt,
      );
    });
    if (statements.length) await db.batch(statements);
  }
}

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

export async function syncShiprocketOrders(runtime: RuntimeEnv, mode: SyncMode = "incremental", source = "manual") {
  const db = runtime.DB;
  if (!db) throw new Error("Database binding is unavailable");
  await ensureSchema(db);
  const initialSync = await db.prepare("SELECT value FROM sync_state WHERE key = 'initial_sync_completed_at'").first<{ value: string }>();
  const effectiveMode: SyncMode = mode === "incremental" && !initialSync?.value ? "full" : mode;
  await logActivity(db, source, "sync.started", `${effectiveMode === "full" ? "Full" : "Incremental"} Shiprocket sync started`, { mode: effectiveMode });
  await setSyncState(db, "sync_status", "running");
  await setSyncState(db, "last_sync_started_at", new Date().toISOString());
  try {
    const token = await getShiprocketToken(runtime);
    const channel = await resolveChannel(runtime, token);
    let page = 1, totalPages = 1, synced = 0;
    do {
      const params = new URLSearchParams({ page: String(page), per_page: "100", sort: "DESC", sort_by: "id", channel_id: String(channel.id) });
      if (effectiveMode === "incremental") {
        const from = new Date();
        from.setUTCDate(from.getUTCDate() - 2);
        params.set("updated_from", dateOnly(from));
        params.set("updated_to", dateOnly(new Date()));
      }
      const result = await apiJson<{ data?: ShiprocketOrder[]; meta?: { pagination?: { total_pages?: number } } }>(
        `${API_ROOT}/orders?${params.toString()}`,
        { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
      );
      const pageOrders = result.data || [];
      await upsertOrders(db, pageOrders);
      synced += pageOrders.length;
      totalPages = Math.min(Number(result.meta?.pagination?.total_pages || 1), 500);
      page += 1;
    } while (page <= totalPages);
    const completedAt = new Date().toISOString();
    await setSyncState(db, "channel_id", String(channel.id));
    await setSyncState(db, "channel_name", channel.name);
    await setSyncState(db, "last_sync_at", completedAt);
    await setSyncState(db, "last_sync_mode", effectiveMode);
    await setSyncState(db, "last_sync_count", String(synced));
    await setSyncState(db, "sync_status", "healthy");
    await setSyncState(db, "last_sync_error", "");
    if (effectiveMode === "full") await setSyncState(db, "initial_sync_completed_at", completedAt);
    await logActivity(db, source, "sync.completed", `Verified ${synced} Shiprocket orders`, {
      synced, channelId: channel.id, channelName: channel.name, mode: effectiveMode,
    });
    return { synced, channelId: channel.id, channelName: channel.name, completedAt, mode: effectiveMode };
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
