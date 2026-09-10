"use client";

import { FormEvent, useEffect, useState } from "react";

type ComponentRow = {
  id: string; sku: string; name: string; unit: string; recoverable: boolean; active: boolean; reorderLevel: number;
  physicalStock: number; allocatedStock: number; availableStock: number; incomingStock: number;
};
type ProductRow = { id: string; sku: string; title: string; variantTitle: string; vendor: string; active: boolean; syncedAt: string };
type PurchaseOrderRow = { id: string; poNumber: string; supplierName: string; status: string; orderDate: string; expectedDate: string; orderedQuantity: number; receivedQuantity: number; remainingValue: number };
type InventoryData = {
  summary: { componentCount: number; productCount: number; lowStockCount: number; allocatedComponentCount: number; incomingComponentCount: number; openPoCount: number };
  components: ComponentRow[]; products: ProductRow[]; purchaseOrders: PurchaseOrderRow[];
  shopify: { configured: boolean; lastSyncAt: string; lastSyncCount: number };
};

const empty: InventoryData = { summary: { componentCount: 0, productCount: 0, lowStockCount: 0, allocatedComponentCount: 0, incomingComponentCount: 0, openPoCount: 0 }, components: [], products: [], purchaseOrders: [], shopify: { configured: false, lastSyncAt: "", lastSyncCount: 0 } };
const quantity = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value || 0);
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
const dateTime = (value: string) => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";

export default function InventoryPanel({ active, isAdmin }: { active: boolean; isAdmin: boolean }) {
  const [data, setData] = useState<InventoryData>(empty);
  const [tab, setTab] = useState<"components" | "purchase_orders" | "products">("components");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stockInputs, setStockInputs] = useState<Record<string, string>>({});
  const [stockReasons, setStockReasons] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/inventory", { cache: "no-store" });
      const payload = await response.json() as InventoryData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load inventory");
      setData(payload); setError("");
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load inventory"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [active]);

  async function mutate(payload: Record<string, unknown>, key: string, success: string) {
    setBusy(key); setError(""); setNotice("");
    try {
      const response = await fetch("/api/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Inventory update failed");
      setNotice(success); await load(); return true;
    } catch (mutationError) { setError(mutationError instanceof Error ? mutationError.message : "Inventory update failed"); return false; }
    finally { setBusy(""); }
  }

  async function createComponent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const values = new FormData(form);
    if (await mutate({ action: "create_component", name: values.get("name"), sku: values.get("sku"), unit: values.get("unit"), componentTypeId: values.get("componentTypeId"), reorderLevel: values.get("reorderLevel"), recoverable: values.get("recoverable") === "on" }, "component", "Component created.")) form.reset();
  }

  async function createPo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const values = new FormData(form);
    if (await mutate({ action: "create_purchase_order", supplierName: values.get("supplierName"), poNumber: values.get("poNumber"), expectedDate: values.get("expectedDate"), componentId: values.get("componentId"), description: values.get("description"), orderedQuantity: values.get("orderedQuantity"), unitCost: values.get("unitCost") }, "po", "Purchase order created.")) form.reset();
  }

  return <section className={`inventory-view ${!active ? "view-hidden" : ""}`}>
    <div className="inventory-health">
      <div><span>Shopify catalog</span><strong>{data.shopify.configured ? `${data.shopify.lastSyncCount} variants synced` : "Awaiting secure credentials"}</strong><small>Last import: {dateTime(data.shopify.lastSyncAt)}</small></div>
      {isAdmin && <button disabled={!data.shopify.configured || Boolean(busy)} onClick={() => void mutate({ action: "sync_shopify" }, "shopify", "Shopify catalog synchronized.")}>{busy === "shopify" ? "Importing…" : "Sync Shopify catalog"}</button>}
    </div>
    {error && <div className="error-banner"><span>!</span><p>{error}</p><button onClick={() => void load()}>Try again</button></div>}
    {notice && <div className="inventory-notice">{notice}</div>}
    <div className="inventory-metrics">
      <article><span>Components</span><strong>{data.summary.componentCount}</strong><small>Tracked in their own units</small></article>
      <article><span>Low stock</span><strong>{data.summary.lowStockCount}</strong><small>At or below reorder level</small></article>
      <article><span>Allocated</span><strong>{data.summary.allocatedComponentCount}</strong><small>Components reserved for orders</small></article>
      <article><span>Incoming</span><strong>{data.summary.incomingComponentCount}</strong><small>Components on open POs</small></article>
      <article><span>Open POs</span><strong>{data.summary.openPoCount}</strong><small>Ordered or partly received</small></article>
    </div>
    <nav className="inventory-tabs" aria-label="Inventory sections">
      <button className={tab === "components" ? "active" : ""} onClick={() => setTab("components")}>Components <span>{data.summary.componentCount}</span></button>
      <button className={tab === "purchase_orders" ? "active" : ""} onClick={() => setTab("purchase_orders")}>Purchase orders <span>{data.purchaseOrders.length}</span></button>
      <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>Shopify products <span>{data.summary.productCount}</span></button>
    </nav>

    {tab === "components" && <>
      {isAdmin && <form className="inventory-form" onSubmit={createComponent}>
        <header><h2>Add component</h2><p>Create a raw material, insert, accessory or packaging item.</p></header>
        <label>Name<input name="name" required /></label><label>SKU / code<input name="sku" required /></label>
        <label>Type<select name="componentTypeId"><option value="accessory">Accessory</option><option value="insert">Insert</option><option value="inner-packaging">Inner packaging</option><option value="outer-packaging">Outer packaging</option><option value="courier-box">Courier box</option><option value="other">Other</option></select></label>
        <label>Unit<input name="unit" defaultValue="unit" required /></label><label>Reorder level<input name="reorderLevel" type="number" min="0" step="0.01" defaultValue="0" /></label>
        <label className="inventory-check"><input name="recoverable" type="checkbox" defaultChecked />Recoverable after RTO QC</label>
        <button disabled={Boolean(busy)}>{busy === "component" ? "Saving…" : "Add component"}</button>
      </form>}
      <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Component</th><th>Physical</th><th>Allocated</th><th>Available</th><th>Incoming</th><th>Reorder</th>{isAdmin && <th>Manual quantity</th>}</tr></thead><tbody>
        {data.components.map((component) => <tr key={component.id}><td><strong>{component.name}</strong><small>{component.sku} · {component.unit}{component.recoverable ? " · Recoverable" : ""}</small></td><td>{quantity(component.physicalStock)}</td><td>{quantity(component.allocatedStock)}</td><td><strong className={component.availableStock <= component.reorderLevel ? "stock-low" : ""}>{quantity(component.availableStock)}</strong></td><td>{quantity(component.incomingStock)}</td><td>{quantity(component.reorderLevel)}</td>{isAdmin && <td><div className="stock-override"><input aria-label={`Set ${component.name} quantity`} type="number" min="0" step="0.01" value={stockInputs[component.id] ?? String(component.physicalStock)} onChange={(event) => setStockInputs((current) => ({ ...current, [component.id]: event.target.value }))}/><input aria-label={`Reason for changing ${component.name}`} placeholder="Reason required" value={stockReasons[component.id] ?? ""} onChange={(event) => setStockReasons((current) => ({ ...current, [component.id]: event.target.value }))}/><button disabled={Boolean(busy) || !stockReasons[component.id]?.trim()} onClick={() => void mutate({ action: "set_quantity", componentId: component.id, quantity: stockInputs[component.id] ?? component.physicalStock, reason: stockReasons[component.id] }, `stock:${component.id}`, `${component.name} quantity updated.`)}>{busy === `stock:${component.id}` ? "…" : "Update"}</button></div></td>}</tr>)}
      </tbody></table>{!loading && !data.components.length && <div className="inventory-empty">No components yet. Add the first component to establish opening stock.</div>}{loading && <div className="inventory-empty">Loading inventory…</div>}</div>
    </>}

    {tab === "purchase_orders" && <>
      {isAdmin && <form className="inventory-form po-form" onSubmit={createPo}>
        <header><h2>Create purchase order</h2><p>The first line establishes incoming stock; additional receiving and invoice matching follow in the next slice.</p></header>
        <label>PO number<input name="poNumber" required /></label><label>Supplier<input name="supplierName" required /></label><label>Expected date<input name="expectedDate" type="date" /></label>
        <label>Component<select name="componentId"><option value="">Unmapped item</option>{data.components.map((component) => <option key={component.id} value={component.id}>{component.name} · {component.sku}</option>)}</select></label>
        <label>Description<input name="description" required /></label><label>Ordered quantity<input name="orderedQuantity" type="number" min="0.01" step="0.01" required /></label><label>Unit cost<input name="unitCost" type="number" min="0" step="0.01" defaultValue="0" /></label>
        <button disabled={Boolean(busy)}>{busy === "po" ? "Saving…" : "Create PO"}</button>
      </form>}
      <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Ordered</th><th>Received</th><th>Expected</th><th>Outstanding value</th></tr></thead><tbody>{data.purchaseOrders.map((po) => <tr key={po.id}><td><strong>{po.poNumber}</strong><small>{po.orderDate}</small></td><td>{po.supplierName}</td><td><span className="inventory-status">{po.status.replaceAll("_", " ")}</span></td><td>{quantity(po.orderedQuantity)}</td><td>{quantity(po.receivedQuantity)}</td><td>{po.expectedDate || "—"}</td><td>{money(po.remainingValue)}</td></tr>)}</tbody></table>{!loading && !data.purchaseOrders.length && <div className="inventory-empty">No purchase orders yet.</div>}</div>
    </>}

    {tab === "products" && <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Vendor</th><th>Status</th><th>Last synced</th></tr></thead><tbody>{data.products.map((product) => <tr key={product.id}><td><strong>{product.title}</strong><small>{product.variantTitle}</small></td><td>{product.sku || <span className="stock-low">Missing SKU</span>}</td><td>{product.vendor || "—"}</td><td>{product.active ? "Active" : "Inactive"}</td><td>{dateTime(product.syncedAt)}</td></tr>)}</tbody></table>{!loading && !data.products.length && <div className="inventory-empty">No Shopify variants imported. Configure fresh credentials, then run the catalog sync.</div>}</div>}
  </section>;
}
