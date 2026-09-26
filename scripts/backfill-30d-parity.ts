import { getRuntimeEnv } from "../lib/database";
import { getShiprocketToken, resolveChannel } from "../lib/shiprocket";
import postgres from "postgres";

type ShiprocketOrder = Record<string, unknown>;

const stringValue = (value: unknown) => value == null ? "" : String(value);
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const firstPositiveNumber = (...values: unknown[]) => {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed > 0) return parsed;
  }
  return 0;
};
const monthNumbers: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function normalizeShiprocketDate(value: unknown) {
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

function completePhone(...values: unknown[]) {
  for (const v of values) {
    const s = stringValue(v).replace(/\D/g, "");
    if (s.length >= 10) return s.slice(-10);
  }
  return "";
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
    customerEmail: stringValue(order.customer_email), customerPhone: completePhone(order.customer_phone_unmasked, others.billing_phone_number, order.customer_phone, others.billing_phone, order.shipping_phone, order.billing_phone),
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
    total: firstPositiveNumber(order.total, order.sub_total, order.total_amount, order.order_total, order.amount),
    shippingCost: numberValue(shipment.shipping_charges || shipment.cost || order.shipping_charges || order.freight_charges),
    pickupLocation: stringValue(order.pickup_location), awb: stringValue(shipment.awb),
    courier: stringValue(shipment.courier || shipment.courier_name),
    shipmentId: numberValue(shipment.id || shipment.shipment_id) || null,
    productsJson: JSON.stringify(Array.isArray(order.products) ? order.products : []), rawJson: JSON.stringify(order),
    isHighRisk: ["high", "very high"].includes(String(order.rto_risk || "").toLowerCase().replace(/[_-]/g, " ").trim()),
  };
}

async function upsertSnapshots(sql: postgres.Sql, snapshots: ReturnType<typeof orderSnapshot>[]) {
  if (!snapshots.length) return;
  const syncedAt = new Date().toISOString();

  for (let start = 0; start < snapshots.length; start += 50) {
    const chunk = snapshots.slice(start, start + 50);
    const validSnapshots = chunk.filter((v) => Boolean(v.id));
    if (!validSnapshots.length) continue;

    for (const v of validSnapshots) {
      await sql`
        INSERT INTO orders (
          id, channel_order_id, channel_id, channel_name, customer_name, customer_email,
          customer_phone, customer_city, customer_state, order_date, created_at, updated_at, delivered_at,
          shipped_at, out_for_delivery_at, first_out_for_delivery_at,
          status, status_code, payment_method, payment_status, total, shipping_cost, pickup_location,
          awb, courier, shipment_id, products_json, raw_json, synced_at, is_high_risk
        ) VALUES (
          ${v.id}, ${v.channelOrderId}, ${v.channelId}, ${v.channelName}, ${v.customerName}, ${v.customerEmail},
          ${v.customerPhone}, ${v.customerCity}, ${v.customerState}, ${v.orderDate}, ${v.createdAt}, ${v.updatedAt}, ${v.deliveredAt},
          ${v.shippedAt}, ${v.outForDeliveryAt}, ${v.firstOutForDeliveryAt},
          ${v.status}, ${v.statusCode}, ${v.paymentMethod}, ${v.paymentStatus}, ${v.total}, ${v.shippingCost}, ${v.pickupLocation},
          ${v.awb}, ${v.courier}, ${v.shipmentId}, ${v.productsJson}, ${v.rawJson}, ${syncedAt}, ${v.isHighRisk}
        )
        ON CONFLICT(id) DO UPDATE SET
          channel_order_id = EXCLUDED.channel_order_id,
          channel_id = EXCLUDED.channel_id,
          channel_name = EXCLUDED.channel_name,
          customer_name = EXCLUDED.customer_name,
          customer_email = EXCLUDED.customer_email,
          customer_phone = CASE WHEN EXCLUDED.customer_phone <> '' THEN EXCLUDED.customer_phone ELSE orders.customer_phone END,
          customer_city = EXCLUDED.customer_city,
          customer_state = EXCLUDED.customer_state,
          order_date = EXCLUDED.order_date,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          delivered_at = COALESCE(NULLIF(EXCLUDED.delivered_at, ''), orders.delivered_at),
          shipped_at = COALESCE(NULLIF(EXCLUDED.shipped_at, ''), orders.shipped_at),
          out_for_delivery_at = CASE
            WHEN EXCLUDED.out_for_delivery_at = '' THEN orders.out_for_delivery_at
            WHEN orders.out_for_delivery_at = '' THEN EXCLUDED.out_for_delivery_at
            WHEN EXCLUDED.out_for_delivery_at ~ '^\\d{4}-\\d{2}-\\d{2}T' AND orders.out_for_delivery_at ~ '^\\d{4}-\\d{2}-\\d{2}T'
              THEN CASE WHEN EXCLUDED.out_for_delivery_at::timestamptz > orders.out_for_delivery_at::timestamptz THEN EXCLUDED.out_for_delivery_at ELSE orders.out_for_delivery_at END
            ELSE GREATEST(EXCLUDED.out_for_delivery_at, orders.out_for_delivery_at)
          END,
          first_out_for_delivery_at = CASE
            WHEN EXCLUDED.first_out_for_delivery_at = '' THEN orders.first_out_for_delivery_at
            WHEN orders.first_out_for_delivery_at = '' THEN EXCLUDED.first_out_for_delivery_at
            WHEN EXCLUDED.first_out_for_delivery_at ~ '^\\d{4}-\\d{2}-\\d{2}T' AND orders.first_out_for_delivery_at ~ '^\\d{4}-\\d{2}-\\d{2}T'
              THEN CASE WHEN EXCLUDED.first_out_for_delivery_at::timestamptz < orders.first_out_for_delivery_at::timestamptz THEN EXCLUDED.first_out_for_delivery_at ELSE orders.first_out_for_delivery_at END
            ELSE LEAST(EXCLUDED.first_out_for_delivery_at, orders.first_out_for_delivery_at)
          END,
          status = EXCLUDED.status,
          status_code = EXCLUDED.status_code,
          payment_method = EXCLUDED.payment_method,
          payment_status = EXCLUDED.payment_status,
          total = EXCLUDED.total,
          shipping_cost = CASE WHEN EXCLUDED.shipping_cost > 0 THEN EXCLUDED.shipping_cost ELSE orders.shipping_cost END,
          pickup_location = EXCLUDED.pickup_location,
          awb = EXCLUDED.awb,
          courier = EXCLUDED.courier,
          shipment_id = EXCLUDED.shipment_id,
          products_json = EXCLUDED.products_json,
          raw_json = (EXCLUDED.raw_json::jsonb || CASE WHEN orders.raw_json::jsonb->'shopify_tags' IS NOT NULL THEN jsonb_build_object('shopify_tags',orders.raw_json::jsonb->'shopify_tags') ELSE '{}'::jsonb END)::text,
          synced_at = EXCLUDED.synced_at,
          is_high_risk = EXCLUDED.is_high_risk
      `;
    }
  }
}

async function runBackfill() {
  console.log("=== STARTING 30-DAY BACKFILL & RECONCILIATION ===");
  const runtime = getRuntimeEnv();
  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 2, connect_timeout: 15 });

  const token = await getShiprocketToken(runtime);
  const channel = await resolveChannel(runtime, token);
  console.log(`Authenticated with Shiprocket. Channel: ${channel.name} (ID: ${channel.id})`);

  const fromDate = "2026-08-25";
  const toDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  console.log(`Syncing orders from ${fromDate} to ${toDate}...`);

  const fetchPageWithRetry = async (page: number, maxRetries = 3): Promise<{ orders: ShiprocketOrder[]; totalPages: number }> => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const params = new URLSearchParams({
          page: String(page),
          per_page: "100",
          channel_id: String(channel.id),
          from: fromDate,
          to: toDate,
          sort: "DESC",
          sort_by: "id"
        });
        const url = `https://apiv2.shiprocket.in/v1/external/orders?${params.toString()}`;
        const res = await fetch(url, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }
        const json = await res.json();
        return {
          orders: json.data || [],
          totalPages: Number(json.meta?.pagination?.total_pages || 1)
        };
      } catch (err) {
        console.warn(`[Page ${page}] Attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
        if (attempt === maxRetries) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
    throw new Error(`Exhausted retries for page ${page}`);
  };

  const first = await fetchPageWithRetry(1);
  const totalPages = first.totalPages;
  console.log(`Total pages to process: ${totalPages} (~${totalPages * 100} orders)`);

  let totalSynced = 0;
  if (first.orders.length > 0) {
    const snapshots = first.orders.map(orderSnapshot);
    await upsertSnapshots(sql, snapshots);
    totalSynced += first.orders.length;
    console.log(`Page 1/${totalPages} processed (${totalSynced} orders)`);
  }

  // Iterate sequentially to ensure stable database writes and avoid Shiprocket rate limits
  for (let page = 2; page <= totalPages; page++) {
    const result = await fetchPageWithRetry(page);
    if (result.orders.length > 0) {
      const snapshots = result.orders.map(orderSnapshot);
      await upsertSnapshots(sql, snapshots);
      totalSynced += result.orders.length;
      console.log(`Page ${page}/${totalPages} processed (${totalSynced} orders)`);
    }
    // Small polite delay
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nShiprocket API sync completed! Total orders synced/updated: ${totalSynced}`);

  // Update sync_state in DB
  const now = new Date().toISOString();
  await sql`
    INSERT INTO sync_state (key, value, updated_at) VALUES ('last_sync_at', ${now}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `;
  await sql`
    INSERT INTO sync_state (key, value, updated_at) VALUES ('sync_status', 'healthy', ${now})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `;
  await sql`
    INSERT INTO sync_state (key, value, updated_at) VALUES ('last_sync_count', ${String(totalSynced)}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `;

  console.log("=== BACKFILL FINISHED SUCCESSFULLY ===");
  await sql.end();
}

runBackfill().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
