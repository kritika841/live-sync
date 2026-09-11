"use client";

import { Modal } from "./Modal";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, GripVertical, MoreHorizontal, Search, UsersRound } from "lucide-react";

type Attempt = { attemptNumber: number; outcome: string; note: string; rejectionReason?: string; nextActionAt?: string; createdAt: string };
type ConfirmationOrder = {
  id: number; channelOrderId: string; customerName: string; customerPhone: string; customerCity: string;
  customerState: string; customerAddress: string; customerPincode: string; orderDate: string; status: string;
  paymentMethod: string; total: number; products: Array<{ name?: string; quantity?: number; sku?: string }>;
  confirmationStatus: string; campaignName?: string; confirmedAt?: string; rejectedAt?: string; tags: string[]; attempts: Attempt[];
};
type Campaign = {
  id: string; name: string; description: string; position: number; isActive: boolean; autoAssign: boolean;
  orderCount: number; criteria: { risk?: string; paymentMethod?: string; tags?: string[]; dateFrom?: string; dateTo?: string };
};
type ConfirmationData = {
  queue: ConfirmationOrder[]; confirmed: ConfirmationOrder[]; rejected: ConfirmationOrder[]; candidates: ConfirmationOrder[];
  campaigns: Campaign[]; availableTags: string[]; counts: { queue: number; confirmed: number; rejected: number; approved: number };
};
type Mode = "queue" | "confirmed" | "rejected";
type OrderAction = "confirm" | "callback" | "unreachable" | "reject";

const emptyData: ConfirmationData = { queue: [], confirmed: [], rejected: [], candidates: [], campaigns: [], availableTags: [], counts: { queue: 0, confirmed: 0, rejected: 0, approved: 0 } };

function when(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function productSummary(products: ConfirmationOrder["products"]) {
  return products.length ? products.map((product) => `${product.name || product.sku || "Product"}${product.quantity ? ` ×${product.quantity}` : ""}`).join(", ") : "—";
}

export default function ConfirmationPanel({ active, section, preview=false }: { active: boolean; preview?:boolean; section: "confirmation" | "campaigns" }) {
  const [mode, setMode] = useState<Mode>("queue");
  const [data, setData] = useState<ConfirmationData>(emptyData);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ConfirmationOrder | null>(null);
  const [orderAction, setOrderAction] = useState<OrderAction>("confirm");
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [rejectionReason, setRejectionReason] = useState("customer_cancelled");
  const [createOpen, setCreateOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [campaignPayment, setCampaignPayment] = useState("all");
  const [campaignDateFrom, setCampaignDateFrom] = useState("");
  const [campaignDateTo, setCampaignDateTo] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [autoAssign, setAutoAssign] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());
  const [draggedCampaignId, setDraggedCampaignId] = useState("");
  const [openCampaignMenu, setOpenCampaignMenu] = useState("");
  const [confirmationSearch, setConfirmationSearch] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/confirmation", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load confirmations");
      setData(payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load confirmations");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || preview) return;
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(true), 30000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [active, load, preview]);

  useEffect(() => {
    if (!createOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setCreateOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, createOpen]);

  async function post(payload: Record<string, unknown>) {
    if (preview) { setError("Connection unavailable"); return false; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/confirmation", {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "satmi-orders-dashboard" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Action failed");
      await load(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openAction(order: ConfirmationOrder, action: OrderAction) {
    setSelectedOrder(order); setOrderAction(action); setNote(""); setCallbackAt(""); setRejectionReason("customer_cancelled");
  }

  async function submitOrderAction(event: FormEvent) {
    event.preventDefault();
    if (!selectedOrder) return;
    const complete = await post({ action: orderAction, orderId: selectedOrder.id, note, callbackAt, rejectionReason });
    if (complete) setSelectedOrder(null);
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    const matchingIds = new Set(candidates.map((order) => order.id));
    const complete = await post({ action: "create_campaign", name: campaignName, description: campaignDescription, autoAssign, criteria: { paymentMethod: campaignPayment, tags: [...selectedTags], dateFrom: campaignDateFrom, dateTo: campaignDateTo }, orderIds: [...selectedCandidates].filter((id) => matchingIds.has(id)) });
    if (complete) { setCreateOpen(false); setCampaignName(""); setCampaignDescription(""); setSelectedCandidates(new Set()); setSelectedTags(new Set()); setCampaignDateFrom(""); setCampaignDateTo(""); }
  }

  async function moveCampaign(index: number, direction: -1 | 1) {
    const next = [...data.campaigns];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await post({ action: "reorder_campaigns", campaignIds: next.map((campaign) => campaign.id) });
  }

  async function dropCampaign(targetCampaignId: string) {
    if (!draggedCampaignId || draggedCampaignId === targetCampaignId) return setDraggedCampaignId("");
    const next = [...data.campaigns];
    const from = next.findIndex((campaign) => campaign.id === draggedCampaignId);
    const to = next.findIndex((campaign) => campaign.id === targetCampaignId);
    if (from < 0 || to < 0) return setDraggedCampaignId("");
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setData((current) => ({ ...current, campaigns: next }));
    setDraggedCampaignId("");
    await post({ action: "reorder_campaigns", campaignIds: next.map((campaign) => campaign.id) });
  }

  const candidates = (() => {
    const query = candidateSearch.trim().toLowerCase();
    return data.candidates.filter((order) => {
      if (campaignPayment !== "all" && order.paymentMethod?.toLowerCase() !== campaignPayment) return false;
      const orderTags = order.tags.map((tag) => tag.toLowerCase());
      if ([...selectedTags].some((tag) => !orderTags.includes(tag.toLowerCase()))) return false;
      const orderDate = order.orderDate.slice(0, 10);
      if (campaignDateFrom && orderDate < campaignDateFrom) return false;
      if (campaignDateTo && orderDate > campaignDateTo) return false;
      return !query || [order.channelOrderId, order.customerName, order.customerPhone].some((value) => value?.toLowerCase().includes(query));
    });
  })();
  const confirmationOrders = data[mode].filter((order) => {
    const query = confirmationSearch.trim().toLowerCase();
    if (!query) return true;
    const digits = query.replace(/\D/g, "");
    return [order.channelOrderId, order.customerName, order.customerPhone, order.customerCity, order.customerState]
      .some((value) => value?.toLowerCase().includes(query))
      || Boolean(digits && order.customerPhone?.replace(/\D/g, "").includes(digits));
  });

  return (
    <section className={`confirmation-view ${active ? "" : "view-hidden"}`}>
      {section === "confirmation" && <div className="confirmation-mode-tabs">
        <button className={mode === "queue" ? "active" : ""} onClick={() => setMode("queue")}><strong>Queue <b>{data.counts.queue}</b></strong></button>
        <button className={mode === "confirmed" ? "active" : ""} onClick={() => setMode("confirmed")}><strong>Confirmed <b>{data.counts.confirmed}</b></strong></button>
        <button className={mode === "rejected" ? "active rejected" : ""} onClick={() => setMode("rejected")}><strong>Rejected <b>{data.counts.rejected}</b></strong></button>
      </div>}

      {section === "confirmation" && <label className="confirmation-contact-filter"><Search size={16}/><input type="search" value={confirmationSearch} onChange={(event) => setConfirmationSearch(event.target.value)} placeholder="Filter by customer, contact number, order, city or state"/><span>{confirmationOrders.length} shown</span></label>}

      {error && <div className="error-banner"><span>!</span><p>{error}</p><button onClick={() => void load()}>Try again</button></div>}
      {loading ? <div className="confirmation-card confirmation-loading"><i className="loader"/><span>Loading confirmation workspace…</span></div> : null}

      {!loading && section === "confirmation" && mode === "queue" && <article className="confirmation-card">
        <header className="confirmation-header"><div><p className="eyebrow">CONFIRMATION QUEUE</p><h2>High-RTO customer calls</h2><p>Orders are automatically assigned. Scheduled callbacks return when they are due.</p></div><span>{data.counts.approved} approved</span></header>
        {confirmationOrders.length ? <div className="confirmation-orders">{confirmationOrders.map((order) => <div className="confirmation-order" key={order.id}>
          <div className="confirmation-order-main"><strong>#{order.channelOrderId}</strong><small>{when(order.orderDate)} · {order.paymentMethod || "Payment unknown"} · ₹{Number(order.total || 0).toLocaleString("en-IN")}</small><p>{productSummary(order.products)}</p></div>
          <div><strong>{order.customerName || "Customer"}</strong><a href={`tel:${order.customerPhone}`}>{order.customerPhone || "No phone"}</a><small>{[order.customerAddress, order.customerCity, order.customerState, order.customerPincode].filter(Boolean).join(", ") || "No address"}</small></div>
          <div className="confirmation-meta"><span>{order.campaignName || "Confirmation"}</span><small>{order.attempts.length}/3 recall attempts</small>{order.attempts.at(-1) && <small>Last: {order.attempts.at(-1)?.outcome} · {when(order.attempts.at(-1)?.createdAt)}</small>}</div>
          <div className="confirmation-actions"><button className="positive" onClick={() => openAction(order, "confirm")}>Confirm</button><button onClick={() => openAction(order, "callback")}>Callback</button><button onClick={() => openAction(order, "unreachable")}>No answer</button><button className="danger" onClick={() => openAction(order, "reject")}>Reject</button></div>
        </div>)}</div> : <div className="confirmation-empty"><span>✓</span><h3>Queue is clear</h3><p>New high-RTO orders will appear here automatically.</p></div>}
      </article>}

      {!loading && section === "confirmation" && mode === "confirmed" && <article className="confirmation-card confirmed-card">
        <header className="confirmation-header"><div><p className="eyebrow">CONFIRMED ORDERS</p><h2>Customer-approved orders</h2><p>Every order confirmed from the call queue is retained here.</p></div><span>{data.confirmed.length} approved</span></header>
        {confirmationOrders.length ? <div className="confirmation-orders">{confirmationOrders.map((order) => { const latest = order.attempts.at(-1); return <div className="confirmation-order confirmed-order" key={order.id}>
          <div className="confirmation-order-main"><strong>#{order.channelOrderId}</strong><small>Confirmed {when(order.confirmedAt)}</small><p>{productSummary(order.products)}</p></div>
          <div><strong>{order.customerName || "Customer"}</strong><a href={`tel:${order.customerPhone}`}>{order.customerPhone || "No phone"}</a><small>{[order.customerCity, order.customerState].filter(Boolean).join(", ") || "No location"}</small></div>
          <div className="confirmation-meta"><span>{order.campaignName || "Confirmation"}</span><small>{latest?.note || "No confirmation note"}</small></div>
          <div className="confirmed-badge">✓ Customer confirmed</div>
        </div>; })}</div> : <div className="confirmation-empty"><span>✓</span><h3>No confirmed orders yet</h3><p>Approved orders will appear here as soon as a call is completed.</p></div>}
      </article>}

      {!loading && section === "confirmation" && mode === "rejected" && <article className="confirmation-card rejected-card">
        <header className="confirmation-header"><div><p className="eyebrow">REJECTED ORDERS</p><h2>Manual cancellation list</h2><p>These records are stored only in this dashboard. Shiprocket is never cancelled automatically.</p></div><span>{data.rejected.length} to review</span></header>
        {confirmationOrders.length ? <div className="confirmation-orders">{confirmationOrders.map((order) => { const latest = order.attempts.at(-1); return <div className="confirmation-order rejected-order" key={order.id}>
          <div className="confirmation-order-main"><strong>#{order.channelOrderId}</strong><small>Rejected {when(order.rejectedAt)}</small><p>{productSummary(order.products)}</p></div>
          <div><strong>{order.customerName || "Customer"}</strong><a href={`tel:${order.customerPhone}`}>{order.customerPhone || "No phone"}</a><small>{order.customerCity}, {order.customerState}</small></div>
          <div className="confirmation-meta"><span>{latest?.rejectionReason?.replaceAll("_", " ") || "Rejected"}</span><small>{latest?.note || "No note"}</small></div>
          <div className="manual-cancel-badge">Cancel manually in Shiprocket</div>
        </div>; })}</div> : <div className="confirmation-empty"><span>✓</span><h3>No rejected orders</h3><p>Customer cancellations and rejected confirmations will be retained here.</p></div>}
      </article>}

      {!loading && section === "campaigns" && <div className="campaign-layout"><article className="confirmation-card campaign-panel">
        <header className="confirmation-header campaign-panel-header"><div><p className="eyebrow">CAMPAIGN PRIORITY</p><h2>Campaign assignment</h2></div><button className="campaign-create" onClick={() => setCreateOpen(true)}>New campaign</button></header>
        <div className="campaign-list">{data.campaigns.map((campaign, index) => <div className={`campaign-row ${campaign.isActive ? "" : "inactive"} ${draggedCampaignId === campaign.id ? "dragging" : ""}`} key={campaign.id} onDragOver={(event) => event.preventDefault()} onDrop={() => void dropCampaign(campaign.id)}>
          <div className="campaign-drag-handle" role="button" tabIndex={0} draggable={!busy} aria-label={`Move ${campaign.name}. Priority ${index + 1}`} title="Drag to change priority" onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDraggedCampaignId(campaign.id); }} onDragEnd={() => setDraggedCampaignId("")} onKeyDown={(event) => { if (event.key === "ArrowUp") void moveCampaign(index, -1); if (event.key === "ArrowDown") void moveCampaign(index, 1); }}><GripVertical size={18}/></div>
          <div className="campaign-copy"><div className="campaign-title"><strong>{campaign.name}</strong>{campaign.id === "cmp_default_high_rto" && <em>Permanent</em>}</div><p>{campaign.description || "No description"}</p>{(campaign.criteria.tags?.length || campaign.criteria.dateFrom || campaign.criteria.dateTo) && <small>{campaign.criteria.tags?.length ? `Tags: ${campaign.criteria.tags.join(", ")}` : ""}{campaign.criteria.tags?.length && (campaign.criteria.dateFrom || campaign.criteria.dateTo) ? " · " : ""}{campaign.criteria.dateFrom || campaign.criteria.dateTo ? `${campaign.criteria.dateFrom || "Any date"} to ${campaign.criteria.dateTo || "Any date"}` : ""}</small>}</div>
          <div className="campaign-row-meta"><span className="priority-badge">Priority {index + 1}</span><span>{Number(campaign.orderCount)} orders</span><span className="campaign-agent"><UsersRound size={15}/>{campaign.autoAssign ? "Automatic routing" : "Manual selection"}</span></div>
          <div className="campaign-more-wrap"><button className="campaign-more" type="button" aria-label={`Actions for ${campaign.name}`} onClick={() => setOpenCampaignMenu((current) => current === campaign.id ? "" : campaign.id)}><MoreHorizontal size={18}/></button>{openCampaignMenu === campaign.id && <div className="campaign-menu">{!campaign.isActive ? <span>Campaign inactive</span> : <>{campaign.id === "cmp_default_high_rto" && <button disabled={busy} type="button" onClick={() => { setOpenCampaignMenu(""); void post({ action: "set_campaign_routing", campaignId: campaign.id, autoAssign: !campaign.autoAssign }); }}>{campaign.autoAssign ? "Manual override" : "Resume automatic"}</button>}<button disabled={busy} type="button" onClick={() => { setOpenCampaignMenu(""); void post({ action: "deactivate_campaign", campaignId: campaign.id }); }}>Deactivate</button></>}</div>}</div>
        </div>)}</div>
      </article></div>}

      <Modal title="Create campaign" open={createOpen} onClose={()=>setCreateOpen(false)} busy={busy} wide><form className="campaign-workflow" onSubmit={createCampaign}>
        <section className="workflow-panel workflow-section"><div className="workflow-details-grid"><label>Campaign name<input required value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="e.g. B2G1 verification"/></label><label>Description<input value={campaignDescription} onChange={(event) => setCampaignDescription(event.target.value)} placeholder="Optional context"/></label></div></section>
        <section className="workflow-panel workflow-section"><div className="workflow-filter-grid"><label>From date<input type="date" value={campaignDateFrom} max={campaignDateTo || undefined} onChange={(event) => setCampaignDateFrom(event.target.value)}/></label><label>To date<input type="date" value={campaignDateTo} min={campaignDateFrom || undefined} onChange={(event) => setCampaignDateTo(event.target.value)}/></label><label>Payment<select value={campaignPayment} onChange={(event) => setCampaignPayment(event.target.value)}><option value="all">All payments</option><option value="cod">COD</option><option value="prepaid">Prepaid</option></select></label><label className="workflow-toggle" htmlFor="campaign-auto-assign"><input id="campaign-auto-assign" type="checkbox" checked={autoAssign} onChange={(event) => setAutoAssign(event.target.checked)}/><span aria-hidden="true"><i/></span><strong>Auto-assign <small>Include future matching orders</small></strong></label></div>
          <fieldset className="campaign-tags"><legend>Order tags <span>{selectedTags.size ? `${selectedTags.size} selected · ` : ""}All selected tags must be present</span></legend><div className="campaign-tag-options">{data.availableTags.map((tag) => { const selected = selectedTags.has(tag); return <label className={selected ? "selected" : ""} key={tag}><input type="checkbox" checked={selected} onChange={(event) => setSelectedTags((current) => { const next = new Set(current); if (event.target.checked) next.add(tag); else next.delete(tag); return next; })}/><span className="campaign-tag-check" aria-hidden="true">{selected ? "✓" : ""}</span><strong>{tag}</strong></label>; })}</div>{!data.availableTags.length && <p>No order tags are available yet.</p>}{selectedTags.size > 0 && <button className="campaign-tags-clear" type="button" onClick={() => setSelectedTags(new Set())}>Clear selected tags</button>}</fieldset>
        </section>
        <section className="workflow-panel workflow-orders"><div className="candidate-heading"><div><strong>Select current orders <small>{candidates.length} matching</small></strong></div><label className="workflow-search"><Search size={16}/><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Search order, customer or phone"/></label><button type="button" onClick={() => setSelectedCandidates(new Set(candidates.map((order) => order.id)))}>Select matching</button></div>
          <div className="workflow-table-wrap"><table className="workflow-table"><thead><tr><th aria-label="Select order"/><th>Order</th><th>Customer</th><th>Payment</th><th>Order date</th><th>Tags</th><th>Status</th></tr></thead><tbody>{candidates.map((order) => <tr key={order.id}><td><input aria-label={`Select order ${order.channelOrderId}`} type="checkbox" checked={selectedCandidates.has(order.id)} onChange={(event) => setSelectedCandidates((current) => { const next = new Set(current); if (event.target.checked) next.add(order.id); else next.delete(order.id); return next; })}/></td><td><strong>#{order.channelOrderId}</strong></td><td><strong>{order.customerName || "Customer"}</strong><small>{order.customerPhone || "No phone"}</small></td><td><span className={`workflow-status ${order.paymentMethod?.toLowerCase() === "cod" ? "cod" : "prepaid"}`}>{order.paymentMethod || "Unknown"}</span></td><td>{when(order.orderDate)}</td><td><div className="workflow-tag-list">{order.tags.length ? order.tags.map((tag) => <span key={tag}>{tag}</span>) : <small>No tags</small>}</div></td><td><span className="workflow-status ready">{order.confirmationStatus || "Ready"}</span></td></tr>)}</tbody></table>{!candidates.length && <div className="workflow-empty">No orders match the current filters.</div>}</div>
        </section>
        <footer className="workflow-panel workflow-submit"><div><CheckCircle2 size={18}/><span><strong>{selectedCandidates.size} orders selected</strong><small>{autoAssign ? "Future matching orders will be added automatically." : "Only selected current orders will be assigned."}</small></span></div><div><button type="button" onClick={() => setCreateOpen(false)}>Cancel</button><button className="workflow-submit-button" disabled={busy} type="submit">{busy ? "Creating…" : "Create campaign"}</button></div></footer>
      </form></Modal>

      <Modal title="Order confirmation" open={!!selectedOrder} onClose={()=>setSelectedOrder(null)} busy={busy}>{selectedOrder && <form className="confirmation-modal" onSubmit={submitOrderAction}>
        <header><div><p className="eyebrow">ORDER #{selectedOrder.channelOrderId}</p><h2>{orderAction === "confirm" ? "Confirm customer order" : orderAction === "reject" ? "Reject confirmation" : orderAction === "callback" ? "Schedule callback" : "Record no answer"}</h2></div><button type="button" onClick={() => setSelectedOrder(null)}>×</button></header>
        {orderAction === "reject" && <div className="manual-warning"><strong>Dashboard record only</strong><span>You must cancel this order manually in Shiprocket.</span></div>}
        {orderAction === "callback" && <label>Callback time<input required type="datetime-local" value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)}/></label>}
        {orderAction === "reject" && <label>Reason<select value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)}><option value="customer_cancelled">Customer cancelled</option><option value="duplicate_order">Duplicate order</option><option value="incorrect_details">Incorrect details</option><option value="customer_unreachable">Customer unreachable</option><option value="other">Other</option></select></label>}
        <label>Call note<textarea required value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record what the customer said and any useful context" rows={4}/></label>
        <footer><button type="button" onClick={() => setSelectedOrder(null)}>Cancel</button><button className={orderAction === "reject" ? "danger" : "positive"} disabled={busy} type="submit">{busy ? "Saving…" : orderAction === "confirm" ? "Mark approved" : orderAction === "reject" ? "Add to rejected" : "Save attempt"}</button></footer>
      </form>}</Modal>
    </section>
  );
}
