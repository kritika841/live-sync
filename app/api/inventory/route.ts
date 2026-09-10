import { randomUUID } from "node:crypto";
import { isSameOrigin, requireApiAdmin, requireApiUser } from "../../../lib/auth/access";
import { ensureSchema, getRuntimeEnv, logActivity } from "../../../lib/database";
import { shopifyConfigured, syncShopifyCatalog } from "../../../lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const text = (value: unknown) => String(value || "").trim();
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export async function GET() {
  const access = await requireApiUser();
  if (access.response) return access.response;
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const [components, products, purchaseOrders, syncRows, summaryRows] = await runtime.DB.batch([
    runtime.DB.prepare(`SELECT c.id, c.sku, c.name, c.unit, c.recoverable, c.active, c.reorder_level AS reorderLevel,
      COALESCE((SELECT SUM(l.quantity_delta) FROM component_ledger l WHERE l.component_id=c.id),0) AS physicalStock,
      COALESCE((SELECT SUM(r.allocated_quantity-r.consumed_quantity) FROM order_requirements r WHERE r.component_id=c.id),0) AS allocatedStock,
      COALESCE((SELECT SUM(pl.ordered_quantity-pl.received_quantity-pl.rejected_quantity)
        FROM purchase_order_lines pl JOIN purchase_orders po ON po.id=pl.purchase_order_id
        WHERE pl.component_id=c.id AND po.status IN ('ordered','partially_received')),0) AS incomingStock
      FROM inventory_components c ORDER BY c.active DESC, c.name`),
    runtime.DB.prepare(`SELECT id, shopify_product_id AS shopifyProductId, shopify_variant_id AS shopifyVariantId,
      inventory_item_id AS inventoryItemId, sku, title, variant_title AS variantTitle, vendor, active, synced_at AS syncedAt
      FROM inventory_products ORDER BY active DESC, title, variant_title LIMIT 500`),
    runtime.DB.prepare(`SELECT po.id, po.po_number AS poNumber, s.name AS supplierName, po.status,
      po.order_date AS orderDate, po.expected_date AS expectedDate, po.currency,
      COALESCE(SUM(pl.ordered_quantity),0) AS orderedQuantity,
      COALESCE(SUM(pl.received_quantity),0) AS receivedQuantity,
      COALESCE(SUM((pl.ordered_quantity-pl.received_quantity-pl.rejected_quantity)*pl.unit_cost),0) AS remainingValue
      FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
      LEFT JOIN purchase_order_lines pl ON pl.purchase_order_id=po.id
      GROUP BY po.id, s.name ORDER BY po.created_at DESC LIMIT 100`),
    runtime.DB.prepare("SELECT key, value FROM sync_state WHERE key IN ('shopify_catalog_last_sync_at','shopify_catalog_last_sync_count')"),
    runtime.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM inventory_products) AS productCount,
      (SELECT COUNT(*) FROM purchase_orders WHERE status IN ('ordered','partially_received')) AS openPoCount`),
  ]);
  const componentRows = components.results.map((row) => ({
    ...row,
    active: Boolean(row.active), reorderLevel: number(row.reorderLevel),
    physicalStock: number(row.physicalStock), allocatedStock: number(row.allocatedStock),
    availableStock: number(row.physicalStock) - number(row.allocatedStock), incomingStock: number(row.incomingStock),
  }));
  const sync = Object.fromEntries(syncRows.results.map((row) => [String(row.key), String(row.value || "")]));
  const counts = summaryRows.results[0] || {};
  return Response.json({
    summary: {
      componentCount: componentRows.length,
      productCount: number(counts.productCount),
      lowStockCount: componentRows.filter((row) => row.active && row.availableStock <= number(row.reorderLevel)).length,
      allocatedComponentCount: componentRows.filter((row) => row.allocatedStock > 0).length,
      incomingComponentCount: componentRows.filter((row) => row.incomingStock > 0).length,
      openPoCount: number(counts.openPoCount),
    },
    components: componentRows,
    products: products.results,
    purchaseOrders: purchaseOrders.results,
    shopify: { configured: shopifyConfigured(runtime), lastSyncAt: sync.shopify_catalog_last_sync_at || "", lastSyncCount: number(sync.shopify_catalog_last_sync_count) },
  });
}

export async function POST(request: Request) {
  const access = await requireApiAdmin();
  if (access.response) return access.response;
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = text(body.action);
  const now = new Date().toISOString();

  if (action === "sync_shopify") {
    try { return Response.json(await syncShopifyCatalog(runtime, access.user.email)); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Shopify sync failed" }, { status: 502 }); }
  }

  if (action === "create_component") {
    const sku = text(body.sku).toUpperCase();
    const name = text(body.name);
    const unit = text(body.unit) || "unit";
    const typeId = text(body.componentTypeId) || "other";
    const reorderLevel = Number(body.reorderLevel ?? 0);
    if (!sku || !name || !Number.isFinite(reorderLevel) || reorderLevel < 0) return Response.json({ error: "Component name, SKU, and a valid non-negative reorder level are required" }, { status: 400 });
    const id = randomUUID();
    try {
      await runtime.DB.prepare(`INSERT INTO inventory_components
        (id, sku, name, component_type_id, unit, recoverable, active, reorder_level, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?)`).bind(
        id, sku, name, typeId, unit, body.recoverable !== false, reorderLevel, now, now,
      ).run();
      await runtime.DB.prepare(`INSERT INTO inventory_audit_events
        (actor_id, actor_email, action, entity_type, entity_id, after_json, created_at) VALUES (?, ?, 'component.created', 'component', ?, ?, ?)`)
        .bind(access.user.id, access.user.email, id, JSON.stringify({ sku, name, unit, typeId }), now).run();
      return Response.json({ id }, { status: 201 });
    } catch (error) {
      return Response.json({ error: error instanceof Error && /unique/i.test(error.message) ? "That component SKU already exists" : "Could not create component" }, { status: 400 });
    }
  }

  if (action === "set_quantity") {
    const componentId = text(body.componentId);
    const target = Number(body.quantity);
    const reason = text(body.reason);
    if (!componentId || !Number.isFinite(target) || target < 0 || !reason) return Response.json({ error: "Component, non-negative quantity, and reason are required" }, { status: 400 });
    const idempotencyKey = `manual:${access.user.id}:${randomUUID()}`;
    const inserted = await runtime.DB.prepare(`WITH locked AS (
        SELECT pg_advisory_xact_lock(hashtext(?))
      ), balance AS (
        SELECT COALESCE(SUM(quantity_delta),0) AS current FROM component_ledger, locked WHERE component_id=?
      ) INSERT INTO component_ledger
        (component_id, quantity_delta, entry_type, reference_type, reference_id, reason, actor_id, actor_email, idempotency_key, created_at)
      SELECT ?, ?-current, 'manual_override', 'component', ?, ?, ?, ?, ?, ? FROM balance
      WHERE ABS(?-current) > 0.000001 RETURNING id, quantity_delta AS quantityDelta`).bind(
      componentId, componentId, componentId, target, componentId, reason,
      access.user.id, access.user.email, idempotencyKey, now, target,
    ).first<{ id: number; quantityDelta: number }>();
    if (inserted) {
      const delta = number(inserted.quantityDelta);
      await runtime.DB.prepare(`INSERT INTO inventory_audit_events
        (actor_id, actor_email, action, entity_type, entity_id, before_json, after_json, created_at)
        VALUES (?, ?, 'component.quantity_set', 'component', ?, ?, ?, ?)`).bind(
        access.user.id, access.user.email, componentId,
        JSON.stringify({ physicalQuantity: target - delta }), JSON.stringify({ physicalQuantity: target, delta, reason }), now,
      ).run();
    }
    await logActivity(runtime.DB, "Inventory", "inventory.manual_override", `Set inventory quantity to ${target}`, { componentId, target, reason, changed: Boolean(inserted) });
    return Response.json({ changed: Boolean(inserted), quantity: target });
  }

  if (action === "create_purchase_order") {
    const supplierName = text(body.supplierName);
    const poNumber = text(body.poNumber);
    const componentId = text(body.componentId);
    const description = text(body.description);
    const orderedQuantity = Number(body.orderedQuantity);
    const unitCost = Number(body.unitCost ?? 0);
    const expectedDate = text(body.expectedDate);
    if (!supplierName || !poNumber || !description || !Number.isFinite(orderedQuantity) || orderedQuantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) return Response.json({ error: "Supplier, PO number, item, positive ordered quantity, and valid unit cost are required" }, { status: 400 });
    const existingSupplier = await runtime.DB.prepare("SELECT id FROM suppliers WHERE LOWER(name)=LOWER(?)").bind(supplierName).first<{ id: string }>();
    const supplierId = existingSupplier?.id || randomUUID();
    const purchaseOrderId = randomUUID();
    const lineId = randomUUID();
    try {
      await runtime.DB.batch([
        runtime.DB.prepare(`INSERT INTO suppliers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(name) DO NOTHING`).bind(supplierId, supplierName, now, now),
        runtime.DB.prepare(`INSERT INTO purchase_orders
          (id, po_number, supplier_id, status, order_date, expected_date, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'ordered', ?, ?, ?, ?, ?)`).bind(
          purchaseOrderId, poNumber, supplierId, now.slice(0, 10), expectedDate, access.user.email, now, now,
        ),
        runtime.DB.prepare(`INSERT INTO purchase_order_lines
          (id, purchase_order_id, component_id, description, ordered_quantity, unit_cost, created_at)
          VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?)`).bind(lineId, purchaseOrderId, componentId, description, orderedQuantity, unitCost, now),
        runtime.DB.prepare(`INSERT INTO inventory_audit_events
          (actor_id, actor_email, action, entity_type, entity_id, after_json, created_at)
          VALUES (?, ?, 'purchase_order.created', 'purchase_order', ?, ?, ?)`).bind(
          access.user.id, access.user.email, purchaseOrderId, JSON.stringify({ poNumber, supplierName, description, orderedQuantity, unitCost }), now,
        ),
      ]);
      return Response.json({ id: purchaseOrderId }, { status: 201 });
    } catch (error) {
      return Response.json({ error: error instanceof Error && /unique/i.test(error.message) ? "That PO number already exists" : "Could not create purchase order" }, { status: 400 });
    }
  }
  return Response.json({ error: "Unsupported inventory action" }, { status: 400 });
}
