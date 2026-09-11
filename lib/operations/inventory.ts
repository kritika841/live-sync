import {recheckInvoice} from "./invoice-match";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { isAdmin, type DashboardUser } from "../auth/access";
import { HttpError, required, quantity } from "../http";
import { operationsDb } from "./schema";
export function conversion(unit: string, stockUnit: string) {
  if (unit === stockUnit) return 1;
  if (unit === "kg" && stockUnit === "g") return 1000;
  if (unit === "g" && stockUnit === "kg") return 0.001;
  throw new HttpError(400, `Cannot convert ${unit} to ${stockUnit}`);
}
export async function audit(
  sql: TransactionSql,
  u: DashboardUser,
  action: string,
  id: string,
  details: unknown,
) {
  await sql`INSERT INTO inventory_audit_events(actor_id,actor_email,action,entity_type,entity_id,after_json,created_at) VALUES(${u.id},${u.email},${action},'inventory',${id},${JSON.stringify(details)},${new Date().toISOString()})`;
}
async function ledger(
  sql: TransactionSql,
  u: DashboardUser,
  component: string,
  delta: number,
  type: string,
  ref: string,
  key: string,
  reason = "",
) {
  await sql`INSERT INTO component_ledger(component_id,quantity_delta,entry_type,reference_type,reference_id,reason,actor_id,actor_email,idempotency_key,created_at) VALUES(${component},${delta},${type},${type},${ref},${reason},${u.id},${u.email},${key},${new Date().toISOString()})`;
}
export async function inventoryData() {
  const db = await operationsDb();
  return db.transaction(async (sql) => {
    const components =
      await sql`SELECT c.*,COALESCE((SELECT SUM(quantity_delta) FROM component_ledger WHERE component_id=c.id),0) physical, COALESCE((SELECT SUM(required) FROM inventory_order_allocations WHERE component_id=c.id AND state='reserved'),0)+COALESCE((SELECT SUM(allocated_quantity-consumed_quantity) FROM order_requirements WHERE component_id=c.id),0) reserved, COALESCE((SELECT SUM((l.ordered_quantity-l.received_quantity-l.rejected_quantity)*l.conversion_factor) FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.purchase_order_id WHERE l.component_id=c.id AND p.status IN ('ordered','partially_received')),0) incoming FROM inventory_components c ORDER BY c.name`;
    const products =
      await sql`SELECT p.*, (SELECT id FROM recipe_versions WHERE product_id=p.id AND active ORDER BY version DESC LIMIT 1) recipe_id FROM inventory_products p ORDER BY title`;
    const recipes =
      await sql`SELECT r.*,COALESCE(jsonb_agg(jsonb_build_object('component_id',i.component_id,'quantity',i.quantity)) FILTER(WHERE i.id IS NOT NULL),'[]') items FROM recipe_versions r LEFT JOIN recipe_items i ON i.recipe_version_id=r.id WHERE r.active GROUP BY r.id`;
    const vendors = await sql`SELECT * FROM suppliers ORDER BY name`;
    const pos =
      await sql`SELECT p.*,s.name supplier_name,EXISTS(SELECT 1 FROM procurement_documents d WHERE d.entity_id=p.id) has_document FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.created_at DESC LIMIT 500`;
    const lines =
      await sql`SELECT l.*,c.name component_name,c.unit stock_unit,COALESCE((SELECT SUM(il.quantity) FROM supplier_invoice_lines il JOIN supplier_invoices i ON i.id=il.supplier_invoice_id WHERE il.purchase_order_line_id=l.id AND i.status<>'rejected'),0) invoiced_quantity FROM purchase_order_lines l LEFT JOIN inventory_components c ON c.id=l.component_id`;
    const receipts =
      await sql`SELECT r.*,COALESCE(jsonb_agg(jsonb_build_object('component_id',l.component_id,'accepted',l.accepted_quantity,'rejected',l.rejected_quantity,'conversion_factor',l.conversion_factor)) FILTER(WHERE l.id IS NOT NULL),'[]') lines FROM goods_receipts r LEFT JOIN goods_receipt_lines l ON l.goods_receipt_id=r.id GROUP BY r.id ORDER BY r.created_at DESC LIMIT 500`;
    const invoices =
      await sql`SELECT id,supplier_id,purchase_order_id,invoice_number,invoice_date,original_filename,status,grand_total,created_at,extracted_json FROM supplier_invoices ORDER BY created_at DESC LIMIT 500`;
    const sales =
      await sql`SELECT s.*,p.title product_name FROM manual_sales s JOIN inventory_products p ON p.id=s.product_id ORDER BY s.created_at DESC LIMIT 200`;
    const orders =
      await sql`SELECT id,channel_order_id,customer_name,status,products_json FROM orders ORDER BY created_at DESC LIMIT 200`;
    const allocations =
      await sql`SELECT a.*,c.name component_name,c.recoverable FROM inventory_order_allocations a JOIN inventory_components c ON c.id=a.component_id ORDER BY a.created_at DESC LIMIT 2000`;
    const activity =
      await sql`SELECT * FROM inventory_audit_events ORDER BY id DESC LIMIT 300`;
    return {
      components,
      products,
      recipes,
      vendors,
      pos,
      lines,
      receipts,
      invoices,
      sales,
      orders,
      allocations,
      activity,
    };
  });
}
type Body = Record<string, unknown>;
function itemList(v: unknown): Body[] {
  if (!Array.isArray(v) || !v.length || v.length > 100)
    throw new HttpError(400, "Add between 1 and 100 line items");
  return v;
}
async function lockStock(sql: TransactionSql) {
  await sql`SELECT pg_advisory_xact_lock(421993)`;
}
async function available(sql: TransactionSql, id: string) {
  const [r] =
    await sql`SELECT COALESCE((SELECT SUM(quantity_delta) FROM component_ledger WHERE component_id=${id}),0)-COALESCE((SELECT SUM(required) FROM inventory_order_allocations WHERE component_id=${id} AND state='reserved'),0)-COALESCE((SELECT SUM(allocated_quantity-consumed_quantity) FROM order_requirements WHERE component_id=${id}),0) qty`;
  return Number(r.qty);
}
export async function mutateInventory(b: Body, u: DashboardUser) {
  const db = await operationsDb();
  return db.transaction(async (sql) => {
    const now = new Date().toISOString();
    const id = String(b.id || randomUUID());
    const action = String(b.action);
    await lockStock(sql);
    if (action === "component") {
      const unit = required(b.unit, "Unit");
      if (!["unit", "g", "kg", "pack"].includes(unit))
        throw new HttpError(400, "Invalid unit");
      await sql`INSERT INTO inventory_components(id,sku,name,component_type_id,unit,reorder_level,recoverable,grams_per_pack,created_at,updated_at) VALUES(${id},${required(b.sku, "SKU")},${required(b.name, "Name")},'other',${unit},${quantity(b.reorder || 0, "Reorder level", true)},${b.recoverable !== false},${b.gramsPerPack ? quantity(b.gramsPerPack, "Pack weight") : null},${now},${now})`;
    } else if (action === "adjust") {
      const reason = required(b.reason, "Reason");
      const target = quantity(b.quantity, "Stock", true);
      const component = required(b.componentId, "Component");
      const [c] =
        await sql`SELECT id FROM inventory_components WHERE id=${component}`;
      if (!c) throw new HttpError(404, "Component not found");
      const [r] =
        await sql`SELECT COALESCE(SUM(quantity_delta),0) qty FROM component_ledger WHERE component_id=${component}`;
      if (target < Number(r.qty) - (await available(sql, component)))
        throw new HttpError(409, "Cannot reduce stock below reserved quantity");
      await ledger(
        sql,
        u,
        component,
        target - Number(r.qty),
        "adjustment",
        id,
        `adjust:${id}`,
        reason,
      );
    } else if (action === "vendor") {
      await sql`INSERT INTO suppliers(id,name,email,phone,tax_id,created_at,updated_at) VALUES(${id},${required(b.name, "Vendor")},${String(b.email || "")},${String(b.phone || "")},${String(b.taxId || "")},${now},${now}) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,tax_id=EXCLUDED.tax_id,updated_at=EXCLUDED.updated_at`;
    } else if (action === "po") {
      await sql`INSERT INTO purchase_orders(id,po_number,supplier_id,status,order_date,expected_date,vendor_order_number,notes,created_by,created_at,updated_at) VALUES(${id},${required(b.number, "PO number")},${required(b.vendorId, "Vendor")},'ordered',${now.slice(0, 10)},${String(b.expected || "")},${String(b.vendorNumber || "")},${String(b.notes || "")},${u.email},${now},${now})`;
      for (const l of itemList(b.lines)) {
        const [c] =
          await sql`SELECT * FROM inventory_components WHERE id=${required(l.componentId, "Component")}`;
        if (!c) throw new HttpError(404, "Component not found");
        const factor = conversion(String(l.unit), c.unit);
        await sql`INSERT INTO purchase_order_lines(id,purchase_order_id,component_id,description,ordered_quantity,unit_cost,purchase_unit,conversion_factor,created_at) VALUES(${randomUUID()},${id},${c.id},${c.name},${quantity(l.quantity)},${quantity(l.cost, "Cost", true)},${String(l.unit)},${factor},${now})`;
      }
    } else if (action === "receive") {
      const key = required(b.requestKey, "Receipt request key");
      const [old] =
        await sql`SELECT id FROM goods_receipts WHERE request_key=${key}`;
      if (old) return { id: old.id };
      const [p] =
        await sql`SELECT * FROM purchase_orders WHERE id=${required(b.poId, "PO")} FOR UPDATE`;
      if (!p || !["ordered", "partially_received"].includes(p.status))
        throw new HttpError(409, "This PO is not open for receiving");
      await sql`INSERT INTO goods_receipts(id,receipt_number,purchase_order_id,received_at,status,notes,created_by,created_at,posted_at,request_key) VALUES(${id},${"GR-" + id.slice(0, 8).toUpperCase()},${p.id},${now},'posted',${String(b.notes || "")},${u.email},${now},${now},${key})`;
      let count = 0;
      const seen = new Set();
      for (const l of itemList(b.lines)) {
        if (seen.has(l.lineId))
          throw new HttpError(400, "Duplicate receipt line");
        seen.add(l.lineId);
        const a = quantity(l.accepted ?? 0, "Accepted", true),
          r = quantity(l.rejected ?? 0, "Rejected", true);
        if (a + r === 0) continue;
        count++;
        const [line] =
          await sql`SELECT * FROM purchase_order_lines WHERE id=${String(l.lineId)} AND purchase_order_id=${p.id} FOR UPDATE`;
        if (
          !line ||
          a + r >
            Number(line.ordered_quantity) -
              Number(line.received_quantity) -
              Number(line.rejected_quantity) +
              1e-9
        )
          throw new HttpError(409, "Receipt exceeds the remaining PO quantity");
        await sql`INSERT INTO goods_receipt_lines(id,goods_receipt_id,purchase_order_line_id,component_id,accepted_quantity,rejected_quantity,conversion_factor) VALUES(${randomUUID()},${id},${line.id},${line.component_id},${a},${r},${line.conversion_factor})`;
        await sql`UPDATE purchase_order_lines SET received_quantity=received_quantity+${a},rejected_quantity=rejected_quantity+${r} WHERE id=${line.id}`;
        if (a)
          await ledger(
            sql,
            u,
            line.component_id,
            a * Number(line.conversion_factor),
            "receipt",
            id,
            `receipt:${key}:${line.id}`,
          );
      }
      if (!count) throw new HttpError(400, "Enter a received quantity");
      await sql`UPDATE purchase_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM purchase_order_lines WHERE purchase_order_id=${p.id} AND ordered_quantity>received_quantity+rejected_quantity+0.000001) THEN 'partially_received' ELSE 'received' END,updated_at=${now} WHERE id=${p.id}`;
    } else if (action === "reverse_receipt") {
      const reason = required(b.reason, "Reversal reason");
      const [r] =
        await sql`SELECT * FROM goods_receipts WHERE id=${id} FOR UPDATE`;
      if (!r || r.status !== "posted")
        throw new HttpError(409, "Only posted receipts can be reversed");
      for (const l of await sql`SELECT * FROM goods_receipt_lines WHERE goods_receipt_id=${id}`) {
        const delta = Number(l.accepted_quantity) * Number(l.conversion_factor);
        if ((await available(sql, l.component_id)) < delta)
          throw new HttpError(
            409,
            "Received stock is already reserved or consumed",
          );
        await ledger(
          sql,
          u,
          l.component_id,
          -delta,
          "receipt_reversal",
          id,
          `reverse:${id}:${l.id}`,
          reason,
        );
        await sql`UPDATE purchase_order_lines SET received_quantity=received_quantity-${l.accepted_quantity},rejected_quantity=rejected_quantity-${l.rejected_quantity} WHERE id=${l.purchase_order_line_id}`;
      }
      await sql`UPDATE goods_receipts SET status='void' WHERE id=${id}`;
      await sql`UPDATE purchase_orders SET status='partially_received' WHERE id=${r.purchase_order_id}`;
    } else if (action === "cancel_po") {
      const reason = required(b.reason, "Reason");
      const [p] =
        await sql`SELECT * FROM purchase_orders WHERE id=${id} FOR UPDATE`;
      if (!p || !["ordered", "partially_received"].includes(p.status))
        throw new HttpError(409, "PO cannot be closed");
      await sql`UPDATE purchase_orders SET status='closed',notes=notes || ${"\nClosed: " + reason},updated_at=${now} WHERE id=${id}`;
    } else if (action === "recipe") {
      const product = required(b.productId, "Product");
      const items = itemList(b.lines);
      await sql`SELECT id FROM inventory_products WHERE id=${product} FOR UPDATE`;
      const [v] =
        await sql`SELECT COALESCE(MAX(version),0)+1 version FROM recipe_versions WHERE product_id=${product}`;
      await sql`UPDATE recipe_versions SET active=FALSE WHERE product_id=${product}`;
      await sql`INSERT INTO recipe_versions(id,product_id,version,active,created_by,created_at) VALUES(${id},${product},${v.version},TRUE,${u.email},${now})`;
      for (const l of items)
        await sql`INSERT INTO recipe_items(recipe_version_id,component_id,quantity) VALUES(${id},${required(l.componentId, "Component")},${quantity(l.quantity)})`;
    } else if (action === "sale") {
      const key = required(b.requestKey, "Sale key");
      const [old] = await sql`SELECT id FROM manual_sales WHERE id=${key}`;
      if (old) return { id: key };
      const product = required(b.productId, "Product");
      const qty = quantity(b.quantity);
      const items =
        await sql`SELECT i.*,v.version FROM recipe_items i JOIN recipe_versions v ON v.id=i.recipe_version_id WHERE v.product_id=${product} AND v.active`;
      if (!items.length)
        throw new HttpError(409, "Add a recipe before recording this sale");
      for (const l of items) {
        const used = Number(l.quantity) * qty;
        if ((await available(sql, l.component_id)) < used)
          throw new HttpError(409, "Insufficient available component stock");
        await ledger(
          sql,
          u,
          l.component_id,
          -used,
          "manual_sale",
          key,
          `sale:${key}:${l.component_id}`,
        );
      }
      await sql`INSERT INTO manual_sales(id,sale_number,customer_name,product_id,quantity,amount,recipe_snapshot,created_by) VALUES(${key},${"MS-" + key.slice(0, 8).toUpperCase()},${required(b.customer, "Customer")},${product},${qty},${quantity(b.amount, "Amount", true)},${sql.json(items)},${u.email})`;
    } else if (action === "reserve") {
      const order = required(b.orderId, "Order");
      const [o] = await sql`SELECT * FROM orders WHERE id=${order} FOR UPDATE`;
      if (!o) throw new HttpError(404, "Order not found");
      if (/cancel|rto|delivered/i.test(o.status))
        throw new HttpError(409, "This order is not eligible for reservation");
      const existing =
        await sql`SELECT id FROM inventory_order_allocations WHERE order_id=${order}`;
      if (existing.length)
        throw new HttpError(
          409,
          "This order already has an inventory snapshot",
        );
      let products: Body[];
      try {
        products = JSON.parse(o.products_json);
      } catch {
        throw new HttpError(409, "Order products are invalid");
      }
      const totals = new Map<
        string,
        {
          qty: number;
          snap: { sku: string; version: number; quantity: number }[];
        }
      >();
      for (const p of itemList(products)) {
        const sku = required(p.sku, "Order SKU");
        const matches =
          await sql`SELECT id FROM inventory_products WHERE sku=${sku} AND active`;
        if (matches.length !== 1)
          throw new HttpError(
            409,
            `Map SKU ${sku} to exactly one product first`,
          );
        const items =
          await sql`SELECT i.*,v.version FROM recipe_items i JOIN recipe_versions v ON v.id=i.recipe_version_id WHERE v.product_id=${matches[0].id} AND v.active`;
        if (!items.length)
          throw new HttpError(409, `Add a recipe for ${sku} first`);
        for (const l of items) {
          const t = totals.get(l.component_id) || { qty: 0, snap: [] };
          t.qty += Number(l.quantity) * quantity(p.quantity);
          t.snap.push({ sku, version: l.version, quantity: l.quantity });
          totals.set(l.component_id, t);
        }
      }
      for (const [c, t] of totals) {
        if ((await available(sql, c)) < t.qty)
          throw new HttpError(409, "Insufficient stock to reserve this order");
        await sql`INSERT INTO inventory_order_allocations(id,order_id,component_id,required,state,recipe_snapshot) VALUES(${randomUUID()},${order},${c},${t.qty},'reserved',${sql.json(t.snap)})`;
      }
    } else if (["consume", "release", "qc"].includes(action)) {
      const order = required(b.orderId, "Order");
      const [o] = await sql`SELECT status FROM orders WHERE id=${order}`;
      if (!o) throw new HttpError(404, "Order not found");
      const reason = required(b.reason, "Reason");
      const rows =
        await sql`SELECT a.*,c.recoverable FROM inventory_order_allocations a JOIN inventory_components c ON c.id=a.component_id WHERE a.order_id=${order} FOR UPDATE OF a`;
      if (!rows.length)
        throw new HttpError(409, "Reserve inventory for this order first");
      if (
        action === "consume" &&
        !/picked|shipped|in transit|out for delivery|delivered|rto/i.test(
          o.status,
        )
      )
        throw new HttpError(409, "Verified shipment pickup is required");
      for (const r of rows) {
        if (action === "consume" && r.state === "reserved") {
          await ledger(
            sql,
            u,
            r.component_id,
            -Number(r.required),
            "fulfillment",
            order,
            `consume:${r.id}`,
            reason,
          );
          await sql`UPDATE inventory_order_allocations SET state='consumed' WHERE id=${r.id}`;
        }
        if (action === "release" && r.state === "reserved")
          await sql`UPDATE inventory_order_allocations SET state='released' WHERE id=${r.id}`;
        if (action === "qc" && r.state === "consumed" && r.recoverable) {
          if (!/rto/i.test(o.status))
            throw new HttpError(409, "Only RTO orders can be restocked");
          const input = itemList(b.lines).find(
            (l) => l.componentId === r.component_id,
          );
          const qty = quantity(
            input?.quantity ?? 0,
            "Recoverable quantity",
            true,
          );
          if (qty > Number(r.required))
            throw new HttpError(400, "QC quantity exceeds consumed quantity");
          if (qty)
            await ledger(
              sql,
              u,
              r.component_id,
              qty,
              "rto_qc",
              order,
              `qc:${r.id}`,
              reason,
            );
          await sql`UPDATE inventory_order_allocations SET state='returned' WHERE id=${r.id}`;
        }
      }
    } else if (action === "invoice_recheck") {
      const result=await recheckInvoice(sql,id);
      await audit(sql,u,action,id,result);
      return {id,...result};
    } else if (action === "invoice_status") {
      if(!isAdmin(u) && u.role!=="operations")throw new HttpError(403,"Invoice review permission is required");
      if (
        !["review_required", "matched", "approved", "rejected"].includes(
          String(b.status),
        )
      )
        throw new HttpError(400, "Invalid invoice status");
      if(b.status==='matched') {
        const result=await recheckInvoice(sql,id);
        if(result.status!=='matched')throw new HttpError(409,'This invoice still has quantity, receiving or price differences. Recheck it to see the current comparison.');
      }else await sql`UPDATE supplier_invoices SET status=${String(b.status)},updated_at=${now} WHERE id=${id}`;
    } else throw new HttpError(400, "Unknown inventory action");
    await audit(sql, u, action, id, b);
    return { id, ok: true };
  });
}
