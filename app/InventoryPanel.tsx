"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Boxes,
  RefreshCw,
  Plus,
  PackageCheck,
  ArrowUpRight,
  Search,
  FileText,
} from "lucide-react";
import { Modal, useEntryDialog } from "./Modal";
import { readJson } from "../lib/http";
import type { inventoryData } from "../lib/operations/inventory";
import PurchaseOrderForm from "./PurchaseOrderForm";
import ProcurementPdf from "./ProcurementPdf";
import OperationsForm, { type Field } from "./OperationsForm";
type Data = Awaited<ReturnType<typeof inventoryData>>;
const empty = {
  components: [],
  products: [],
  recipes: [],
  vendors: [],
  pos: [],
  lines: [],
  receipts: [],
  invoices: [],
  sales: [],
  orders: [],
  allocations: [],
  activity: [],
} as unknown as Data;
const tabs = [
  ["stock", "Stock & components"],
  ["products", "Products & recipes"],
  ["vendors", "Vendors"],
  ["pos", "Purchase orders"],
  ["invoices", "Invoices"],
  ["sales", "Manual sales"],
  ["orders", "Order insights"],
  ["activity", "Inventory log"],
] as const;
const n = (v: unknown) =>
  Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const date = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString("en-IN") : "—";
const field = (
  name: string,
  label: string,
  type = "text",
  required = true,
): Field => ({ name, label, type, required });
export default function InventoryPanel({
  active,
  isAdmin,
  preview = false,
}: {
  active: boolean;
  isAdmin: boolean;
  preview?: boolean;
}) {
  const [data, setData] = useState<Data>(empty),
    [tab, setTab] = useState<string>("stock"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [search, setSearch] = useState(""),
    [po, setPo] = useState(""),
    [product, setProduct] = useState(""),
    [lines, setLines] = useState([
      { componentId: "", quantity: "", unit: "unit", cost: "0" },
    ]);
  const {requestEntry,dialog} = useEntryDialog();
  const [invoicePo,setInvoicePo] = useState("");
  const [invoiceOpen,setInvoiceOpen]=useState(false);
  const [receiveOpen,setReceiveOpen]=useState(false);
  async function ask(label:string,value?:string){const r=await requestEntry(value===undefined?"Add reason":"QC quantity",[{name:"value",label,type:value===undefined?"text":"number",value}]);return r?.value ?? null;}
  const load = useCallback(async () => {
    if (preview) return;
    setLoading(true);
    try {
      setData(
        await readJson<Data>(
          await fetch("/api/inventory", { cache: "no-store" }),
        ),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load inventory");
    } finally {
      setLoading(false);
    }
  }, [preview]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [active, load]);
  const pending = useRef<{
    signature: string;
    payload: Record<string, unknown>;
  } | null>(null);
  async function save(action: string, b: Record<string, unknown>) {
    if (preview) {
      setError(
        "Connection unavailable.",
      );
      return false;
    }
    const signature = JSON.stringify({
      action,
      ...Object.fromEntries(
        Object.entries(b).filter(([k]) => !["requestKey", "id"].includes(k)),
      ),
    });
    if (pending.current?.signature !== signature)
      pending.current = { signature, payload: { action, ...b } };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await readJson(
        await fetch("/api/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending.current.payload),
        }),
      );
      pending.current = null;
      setNotice("Saved. Inventory and audit history updated.");
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const componentOptions = data.components.map((c) => ({
      value: String(c.id),
      label: `${c.name} · ${c.unit}`,
    })),
    productOptions = data.products.map((p) => ({
      value: String(p.id),
      label: `${p.title} · ${p.sku || "No SKU"}`,
    }));
  const componentSelect: Field = {
    name: "componentId",
    label: "Component",
    options: componentOptions,
  };
  const productSelect: Field = {
    name: "productId",
    label: "Product",
    options: productOptions,
  };
  const selectedPo = data.pos.find((p) => p.id === po);
  const poLines = data.lines.filter((l) => l.purchase_order_id === po);
  function lineEditor(recipe = false) {
    return (
      <div className="ops-lines">
        <div className="ops-line-heading">
          <strong>{recipe ? "Components per product" : "PO line items"}</strong>
          <button
            type="button"
            onClick={() =>
              setLines([
                ...lines,
                { componentId: "", quantity: "", unit: "unit", cost: "0" },
              ])
            }
          >
            <Plus size={14} /> Add line
          </button>
        </div>
        {lines.map((l, i) => (
          <div className="ops-line" key={i}>
            <select
              aria-label="Component"
              value={l.componentId}
              required
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          componentId: e.target.value,
                          unit: String(
                            data.components.find((c) => c.id === e.target.value)
                              ?.unit || "unit",
                          ),
                        }
                      : x,
                  ),
                )
              }
            >
              <option value="">Choose component</option>
              {componentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Quantity"
              type="number"
              step="any"
              min="0.000001"
              required
              placeholder="Quantity"
              value={l.quantity}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === i ? { ...x, quantity: e.target.value } : x,
                  ),
                )
              }
            />
            {!recipe && (
              <>
                <select
                  aria-label="Purchase unit"
                  value={l.unit}
                  onChange={(e) =>
                    setLines(
                      lines.map((x, j) =>
                        j === i ? { ...x, unit: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {["unit", "g", "kg", "pack"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <input
                  aria-label="Unit cost"
                  type="number"
                  step="any"
                  min="0"
                  required
                  placeholder="Unit cost ₹"
                  value={l.cost}
                  onChange={(e) =>
                    setLines(
                      lines.map((x, j) =>
                        j === i ? { ...x, cost: e.target.value } : x,
                      ),
                    )
                  }
                />
              </>
            )}
            <button
              type="button"
              disabled={lines.length === 1}
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    );
  }
  const emptyState = (title: string) => (
    <div className="ops-empty">
      <Boxes size={30} />
      <h3>{title}</h3>

    </div>
  );
  if (!active) return null;
  return (
    <section className="inventory-view ops-workspace">{dialog}
      <div className="inventory-health compact-toolbar">
        <div>
          <strong>Inventory</strong>
        </div>
        <button disabled={busy || loading} onClick={() => void load()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {error && (
        <div className="ops-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="inventory-notice" role="status">
          {notice}
        </div>
      )}
      <div className="inventory-metrics">
        {[
          ["Components", data.components.length, "Tracked stock items"],
          [
            "Low stock",
            data.components.filter(
              (c) =>
                Number(c.physical) - Number(c.reserved) <=
                Number(c.reorder_level),
            ).length,
            "At or below reorder level",
          ],
          [
            "Open POs",
            data.pos.filter((p) =>
              ["ordered", "partially_received"].includes(p.status),
            ).length,
            "Awaiting vendor deliveries",
          ],
          [
            "Recipes pending",
            data.products.filter((p) => !p.recipe_id).length,
            "Add recipes when ready",
          ],
          [
            "Invoices to review",
            data.invoices.filter((i) => i.status === "review_required").length,
            "Linked to purchase orders",
          ],
        ].map(([label, value, sub]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </article>
        ))}
      </div>
      <nav className="inventory-tabs" aria-label="Inventory sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={async () => {
              setTab(key);
              setError("");
              setNotice("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {loading && <p className="ops-muted">Loading current inventory…</p>}
      {tab === "stock" && (
        <>
          <div className="ops-toolbar">
            <h2>Stock & components</h2>
            <label className="ops-search">
              <Search size={14} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or SKU"
              />
            </label>
          </div>
          {isAdmin && (
            <div className="ops-two">
              <OperationsForm
                title="Add component"
                fields={[
                  field("name", "Component name"),
                  field("sku", "SKU"),
                  {
                    name: "unit",
                    label: "Stock unit",
                    options: ["unit", "g", "kg", "pack"].map((v) => ({
                      value: v,
                      label: v,
                    })),
                  },
                  field("reorder", "Reorder level", "number", false),
                  field(
                    "gramsPerPack",
                    "Grams per pack (optional)",
                    "number",
                    false,
                  ),
                ]}
                onSave={(b) => save("component", b)}
                busy={busy}
              />
              <OperationsForm
                title="Set opening stock / adjustment"
                description="To add opening or purchased stock, receive a PO against an invoice. Adjustments reduce physical stock and require a reason."
                fields={[
                  componentSelect,
                  field("quantity", "Physical quantity", "number"),
                  field("reason", "Reason"),
                ]}
                onSave={(b) =>
                  save("adjust", { ...b, id: crypto.randomUUID() })
                }
                busy={busy}
              />
            </div>
          )}
          <div className="inventory-table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  {[
                    "Component",
                    "Physical",
                    "Reserved",
                    "Available",
                    "Incoming",
                    "Pack equivalent",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.components
                  .filter((c) =>
                    (c.name + " " + c.sku)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <small>
                          {c.sku} · {c.unit}
                        </small>
                      </td>
                      <td>
                        {n(c.physical)} {c.unit}
                      </td>
                      <td>{n(c.reserved)}</td>
                      <td
                        className={
                          Number(c.physical) - Number(c.reserved) <=
                          Number(c.reorder_level)
                            ? "stock-low"
                            : ""
                        }
                      >
                        {n(Number(c.physical) - Number(c.reserved))}
                      </td>
                      <td>{n(c.incoming)}</td>
                      <td>
                        {c.grams_per_pack && ["g", "kg"].includes(c.unit)
                          ? `${n(Math.floor((Number(c.physical) * (c.unit === "kg" ? 1000 : 1)) / Number(c.grams_per_pack)))} packs + ${n((Number(c.physical) * (c.unit === "kg" ? 1000 : 1)) % Number(c.grams_per_pack))} g`
                          : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data.components.length &&
              emptyState("Start with your components")}
          </div>

        </>
      )}
      {tab === "vendors" && (
        <>
          <div className="ops-card-grid">
            {data.vendors.map((v) => (
              <article className="ops-card" key={v.id}>
                <h3>{v.name}</h3>
                <p>{v.email || "No email added"}</p>
                <p>{v.phone}</p>
                <small>GST / tax ID: {v.tax_id || "—"}</small>
              </article>
            ))}
          </div>
          {!data.vendors.length &&
            emptyState("Your vendor directory")}{" "}
          {isAdmin && (
            <OperationsForm
              title="Add vendor"
              fields={[
                field("name", "Vendor name"),
                field("email", "Email", "email", false),
                field("phone", "Phone", "text", false),
                field("taxId", "GST / tax ID", "text", false),
                field("address", "Registered address"),
                field("bankDetails", "Bank name, account holder, account number and IFSC"),
              ]}
              onSave={(b) => save("vendor", b)}
              busy={busy}
            />
          )}
        </>
      )}
      {tab === "pos" && (
        <>
          <div className="ops-toolbar">
            <h2>Purchase orders</h2>
            <span className="ops-muted">
              Ordered quantities stay in the purchasing unit
            </span>
          </div>
          <div className="ops-card-grid">
            {data.pos.map((p) => (
              <button
                className={`ops-card selectable ${po === p.id ? "selected" : ""}`}
                key={p.id}
                onClick={() => {setPo(p.id);setReceiveOpen(true);}}
              >
                <span className="inventory-status">
                  {p.status.replaceAll("_", " ")}
                </span>
                <h3>{p.po_number}</h3>
                <p>{p.supplier_name}</p>
                <small>
                  Vendor order: {p.vendor_order_number || "—"} · Due{" "}
                  {p.expected_date || "—"}
                </small>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
          {!data.pos.length &&
            emptyState("No purchase orders yet")}
          {selectedPo && (<Modal title={selectedPo.po_number} open={receiveOpen} onClose={()=>setReceiveOpen(false)} wide busy={busy}>
            <article className="ops-card">
              <div className="ops-toolbar">
                <h2>{selectedPo.po_number} · Receiving</h2>{selectedPo.has_document && <a href={"/api/inventory/documents?id="+selectedPo.id} target="_blank" rel="noreferrer">View original PO PDF</a>}
                <span>{selectedPo.supplier_name}</span>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  await save("receive", {
                    poId: po,
                    requestKey: crypto.randomUUID(),
                    notes: f.get("notes"),
                    invoiceId: f.get("invoiceId"),
                    lines: poLines.map((l) => ({
                      lineId: l.id,
                      accepted: f.get("a" + l.id) || 0,
                      rejected: f.get("r" + l.id) || 0,
                    })),
                  });
                }}
              >
                <div className="inventory-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Component</th>
                        <th>Ordered</th>
                        <th>Accepted</th>
                        <th>Rejected</th><th>Pending</th>
                        <th>Receive now</th>
                        <th>Reject now</th>
                      </tr>
                    </thead>
                    <tbody>
                      {poLines.map((l) => (
                        <tr key={l.id}>
                          <td>
                            {l.component_name}
                            <small>
                              {l.purchase_unit} → {n(l.conversion_factor)}{" "}
                              {l.stock_unit}
                            </small>
                          </td>
                          <td>
                            {n(l.ordered_quantity)} {l.purchase_unit}
                          </td>
                          <td>{n(l.received_quantity)}</td>
                          <td>{n(l.rejected_quantity)}</td><td>{n(Math.max(0,Number(l.ordered_quantity)-Number(l.received_quantity)))}</td>
                          <td>
                            <input
                              aria-label={"Receive " + l.component_name}
                              name={"a" + l.id}
                              type="number"
                              step="any"
                              min="0"
                              defaultValue="0"
                            />
                          </td>
                          <td>
                            <input
                              aria-label={"Reject " + l.component_name}
                              name={"r" + l.id}
                              type="number"
                              step="any"
                              min="0"
                              defaultValue="0"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label>Invoice (required)<select name="invoiceId" required><option value="">Select uploaded invoice</option>{data.invoices.filter(i => i.purchase_order_id===po && i.status!=="rejected").map(i => <option key={i.id} value={i.id}>{i.invoice_number}</option>)}</select></label>
                <p className="ops-muted">Upload the invoice and review its line items in Invoices before posting. Each receipt consumes only that invoice’s remaining quantity.</p>
                <input name="notes" placeholder="Receiving notes" />
                {isAdmin && (
                  <button
                    className="ops-primary"
                    disabled={
                      busy ||
                      !["ordered", "partially_received"].includes(
                        selectedPo.status,
                      )
                    }
                  >
                    <PackageCheck size={15} /> Post receipt & update stock
                  </button>
                )}
              </form>
              <a className="action-launch" href={`/api/inventory/po?id=${encodeURIComponent(po)}`} target="_blank" rel="noreferrer">Download PDF</a><h3>Receipt history</h3>
              {data.receipts
                .filter((r) => r.purchase_order_id === po)
                .map((r) => (
                  <div className="ops-history" key={r.id}>
                    <span>
                      <strong>{r.receipt_number}</strong> · {r.status}
                      <small>
                        {date(r.created_at)} · {r.created_by}
                      </small>
                    </span>
                    {isAdmin && r.status === "posted" && (
                      <button
                        onClick={async () => {
                          const reason = await ask(
                            "Why are you reversing this receipt?",
                          );
                          if (reason)
                            void save("reverse_receipt", { id: r.id, reason });
                        }}
                      >
                        Reverse receipt
                      </button>
                    )}
                  </div>
                ))}
              {isAdmin &&
                ["ordered", "partially_received"].includes(
                  selectedPo.status,
                ) && (
                  <button
                    onClick={async () => {
                      const reason = await ask(
                        "Reason for closing the remaining PO quantity",
                      );
                      if (reason) void save("cancel_po", { id: po, reason });
                    }}
                  >
                    Close remaining PO
                  </button>
                )}
            </article></Modal>
          )}
          {isAdmin && <ProcurementPdf kind="po" components={data.components.map(c=>({id:c.id,name:c.name,sku:c.sku,unit:c.unit}))} vendors={data.vendors.map(v=>({id:v.id,name:v.name}))} pos={data.pos.map(p=>({id:p.id,po_number:p.po_number,supplier_name:p.supplier_name}))} poLines={data.lines.map(l=>({id:l.id,purchase_order_id:l.purchase_order_id,component_id:l.component_id,component_name:l.component_name,purchase_unit:l.purchase_unit,ordered_quantity:Number(l.ordered_quantity),received_quantity:Number(l.received_quantity),unit_cost:Number(l.unit_cost),invoiced_quantity:Number(l.invoiced_quantity)}))} onSaved={load} preview={preview}/>}
          {isAdmin && <PurchaseOrderForm vendors={data.vendors as unknown as Array<{id:string;name:string;phone:string;tax_id:string;address:string}>} components={data.components as unknown as Array<{id:string;name:string;unit:string}>} onSave={b=>save("po",b)} busy={busy}/>}

        </>
      )}
      {tab === "products" && (
        <>
          <div className="ops-toolbar">
            <div>
              <h2>Products & recipes</h2>
              <p className="ops-muted">
                Recipes can be added later. Sales and reservations wait for a
                complete recipe.
              </p>
            </div>
            {isAdmin && (
              <button
                disabled={busy}
                onClick={() => void save("sync_shopify", {})}
              >
                <RefreshCw size={14} /> Sync Shopify products
              </button>
            )}
          </div>
          <div className="ops-card-grid">
            {data.products.map((p) => (
              <button
                className="ops-card selectable"
                key={p.id}
                onClick={() => setProduct(p.id)}
              >
                <h3>{p.title}</h3>
                <p>
                  {p.variant_title} · {p.sku || "Missing SKU"}
                </p>
                <span
                  className={`inventory-status ${!p.recipe_id ? "warning" : ""}`}
                >
                  {p.recipe_id ? "Recipe ready" : "Recipe needed"}
                </span>
              </button>
            ))}
          </div>
          {!data.products.length &&
            emptyState("Your product catalogue")}
          {product && (
            <article className="ops-card">
              <h3>Active recipe</h3>
              {data.recipes
                .filter((r) => r.product_id === product)
                .map((r) => (
                  <div key={r.id}>
                    <span>Version {r.version}</span>
                    {(
                      r.items as { component_id: string; quantity: number }[]
                    ).map((i) => (
                      <p key={i.component_id}>
                        {
                          data.components.find((c) => c.id === i.component_id)
                            ?.name
                        }{" "}
                        · {n(i.quantity)}
                      </p>
                    ))}
                  </div>
                ))}
            </article>
          )}
          {isAdmin && (
            <OperationsForm
              key={product}
              title="Save a new recipe version"
              description="Existing order snapshots keep their original recipe."
              fields={[{ ...productSelect, value: product }]}
              onSave={(b) => save("recipe", { ...b, lines })}
              busy={busy}
            >
              {lineEditor(true)}
            </OperationsForm>
          )}
        </>
      )}
      {tab === "invoices" && (
        <>
          <div className="inventory-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>PO</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.invoice_number}
                      <small>{i.invoice_date}</small>{i.extracted_json && i.extracted_json!=="{}" && <details><summary>Comparison details</summary>{(JSON.parse(i.extracted_json).comparisons||[]).map((c:{description:string;quantity:number;ordered:number;received:number;flags:string[]},j:number)=><p key={j}>{c.description}: invoiced {c.quantity}, ordered {c.ordered}, received {c.received} · {c.flags.length?c.flags.join("; "):"Matched"}</p>)}</details>}
                    </td>
                    <td>
                      {
                        data.pos.find((p) => p.id === i.purchase_order_id)
                          ?.po_number
                      }
                    </td>
                    <td>₹{n(i.grand_total)}</td>
                    <td>
                      {isAdmin ? (
                        <select
                          value={i.status}
                          disabled={busy}
                          onChange={(e) =>
                            void save("invoice_status", {
                              id: i.id,
                              status: e.target.value,
                            })
                          }
                        >
                          {[
                            "review_required",
                            "matched",
                            "approved",
                            "rejected",
                          ].map((s) => (
                            <option key={s} value={s}>
                              {s.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      ) : (
                        i.status
                      )}
                    </td>
                    <td>
                      <a
                        href={"/api/inventory/files?id=" + i.id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <FileText size={14} /> {i.original_filename}
                      </a>{isAdmin && <button disabled={busy} onClick={()=>void save("invoice_recheck",{id:i.id})}>Recheck against PO</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.invoices.length &&
              emptyState("Invoice records")}
          </div>
          {isAdmin && (
            <><ProcurementPdf kind="invoice" components={data.components.map(c=>({id:c.id,name:c.name,sku:c.sku,unit:c.unit}))} vendors={data.vendors.map(v=>({id:v.id,name:v.name}))} pos={data.pos.map(p=>({id:p.id,po_number:p.po_number,supplier_name:p.supplier_name}))} poLines={data.lines.map(l=>({id:l.id,purchase_order_id:l.purchase_order_id,component_id:l.component_id,component_name:l.component_name,purchase_unit:l.purchase_unit,ordered_quantity:Number(l.ordered_quantity),received_quantity:Number(l.received_quantity),unit_cost:Number(l.unit_cost),invoiced_quantity:Number(l.invoiced_quantity)}))} onSaved={load} preview={preview}/><button className="action-launch" onClick={()=>setInvoiceOpen(true)}>+ Upload invoice manually</button><Modal title="Upload invoice" open={invoiceOpen} onClose={()=>setInvoiceOpen(false)} busy={busy}>
            <form
              className="ops-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (preview) {
                  setError("Invoice upload is unavailable in preview.");
                  return;
                }
                const f = e.currentTarget;
                setBusy(true);
                try {
                  await readJson(
                    await fetch("/api/inventory/files", {
                      method: "POST",
                      body: new FormData(f),
                    }),
                  );
                  f.reset();setInvoiceOpen(false);
                  setNotice("Invoice uploaded for review.");
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Upload failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <header>
                <h2>Upload invoice</h2>
                <p>PDF, PNG or JPEG · up to 4 MB · private storage</p>
              </header>
              <div className="ops-fields">
                <label>
                  Purchase order
                  <select name="poId" required value={invoicePo} onChange={e=>setInvoicePo(e.target.value)}>
                    <option value="">Select PO</option>
                    {data.pos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.po_number} · {p.supplier_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Invoice number
                  <input name="number" required />
                </label>
                <label>
                  Invoice date
                  <input name="date" type="date" required />
                </label>
                <label>
                  Total amount ₹
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                  />
                </label>
                <label>
                  Invoice file
                  <input
                    name="file"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    required
                  />
                </label>
              </div>
              <fieldset><legend>Invoice quantities in PO units</legend><p>Enter quantities exactly as shown on the invoice. Leave items not supplied at zero.</p>{data.lines.filter(l=>l.purchase_order_id===invoicePo).map(l=><label key={l.id}>{l.component_name} ({l.purchase_unit})<input name={`quantity:${l.id}`} type="number" min="0" step="any" defaultValue="0"/><span>Unit price</span><input name={`cost:${l.id}`} type="number" min="0" step="any" defaultValue={Number(l.unit_cost)}/></label>)}</fieldset>
              <button className="ops-primary" disabled={busy}>
                Upload & link invoice
              </button>
            </form></Modal></>
          )}
        </>
      )}
      {tab === "sales" && (
        <>
          {isAdmin && (
            <OperationsForm
              title="Record a manual sale"
              description="Uses the active recipe and consumes available stock in one transaction."
              fields={[
                productSelect,
                field("customer", "Customer / reference"),
                field("quantity", "Product quantity", "number"),
                field("amount", "Total sale amount ₹", "number"),
              ]}
              onSave={(b) =>
                save("sale", { ...b, requestKey: crypto.randomUUID() })
              }
              busy={busy}
            />
          )}
          <div className="inventory-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sale</th>
                  <th>Customer</th>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Amount</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {data.sales.map((s) => (
                  <tr key={s.id}>
                    <td>{s.sale_number}</td>
                    <td>{s.customer_name}</td>
                    <td>{s.product_name}</td>
                    <td>{n(s.quantity)}</td>
                    <td>₹{n(s.amount)}</td>
                    <td>{date(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.sales.length &&
              emptyState("No manual sales")}
          </div>
        </>
      )}
      {tab === "orders" && (
        <>
          <div className="ops-toolbar">
            <h2>Order requirements & fulfilment</h2>
            <span className="ops-muted">
              Latest 200 orders · missing recipes block stock allocation
            </span>
          </div>
          <div className="inventory-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Shipping status</th>
                  <th>Inventory</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => {
                  const a = data.allocations.filter(
                    (a) => String(a.order_id) === String(o.id),
                  );
                  return (
                    <tr key={o.id}>
                      <td>{o.channel_order_id}</td>
                      <td>{o.customer_name}</td>
                      <td>{o.status}</td>
                      <td>
                        {a.length
                          ? a.map((r) => (
                              <small key={r.id}>
                                {r.component_name}: {n(r.required)} · {r.state}
                              </small>
                            ))
                          : "Not reserved"}
                      </td>
                      <td>
                        {isAdmin && (
                          <div className="ops-actions">
                            {!a.length ? (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void save("reserve", { orderId: o.id })
                                }
                              >
                                Reserve
                              </button>
                            ) : (
                              <>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void save("consume", {
                                      orderId: o.id,
                                      reason: "Verified fulfilment",
                                    })
                                  }
                                >
                                  Consume
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={async () => {
                                    const reason = await ask(
                                      "Reason to release reservation",
                                    );
                                    if (reason)
                                      void save("release", {
                                        orderId: o.id,
                                        reason,
                                      });
                                  }}
                                >
                                  Release
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={async () => {
                                    const reason = await ask(
                                      "QC notes: condition and reason for restocking",
                                    );
                                    if (!reason) return;
                                    const lines = [];
                                    for (const r of a.filter(
                                      (r) =>
                                        r.recoverable && r.state === "consumed",
                                    )) {
                                      const q = await ask(
                                        `Recoverable ${r.component_name} quantity (maximum ${r.required})`,
                                        "0",
                                      );
                                      if (q === null) return;
                                      lines.push({
                                        componentId: r.component_id,
                                        quantity: q,
                                      });
                                    }
                                    void save("qc", {
                                      orderId: o.id,
                                      reason,
                                      lines,
                                    });
                                  }}
                                >
                                  RTO QC
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!data.orders.length &&
              emptyState("Order insights will appear here")}
          </div>
        </>
      )}
      {tab === "activity" && (
        <>
          <div className="ops-toolbar">
            <h2>Inventory log</h2>
            <span className="ops-muted">Latest 300 events</span>
          </div>
          {data.activity.map((a) => (
            <article className="ops-history" key={a.id}>
              <span>
                <strong>{a.action.replaceAll("_", " ")}</strong>
                <small>
                  {a.actor_email} · {date(a.created_at)}
                </small>
              </span>
              <div className="inventory-log-details">{(() => {const details=JSON.parse(a.after_json || "{}"); return <><span>{details.number || details.invoiceId || details.reason || ""}</span>{(details.lines || details.comparisons || []).map((line: Record<string,unknown>, index:number) => <p key={index}>{String(line.componentName || line.description || line.componentId || "Item")} · {line.accepted !== undefined ? `Accepted ${line.accepted}; rejected ${line.rejected || 0}` : `Quantity ${line.quantity || 0}`} {String(line.stockUnit || line.unit || "")}</p>)}</>;})()}</div>
              <details>
                <summary>Full event details</summary>
                <pre>
                  {JSON.stringify(JSON.parse(a.after_json || "{}"), null, 2)}
                </pre>
              </details>
            </article>
          ))}
          {!data.activity.length &&
            emptyState("A clear history from day one")}
        </>
      )}
    </section>
  );
}
