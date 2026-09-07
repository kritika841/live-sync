"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Attempt = { attemptNumber: number; outcome: string; note: string; rejectionReason?: string; nextActionAt?: string; createdAt: string };
type ConfirmationOrder = {
  id: number; channelOrderId: string; customerName: string; customerPhone: string; customerCity: string;
  customerState: string; customerAddress: string; customerPincode: string; orderDate: string; status: string;
  paymentMethod: string; total: number; products: Array<{ name?: string; quantity?: number; sku?: string }>;
  confirmationStatus: string; campaignName?: string; rejectedAt?: string; attempts: Attempt[];
};
type Campaign = {
  id: string; name: string; description: string; position: number; isActive: boolean; autoAssign: boolean;
  orderCount: number; criteria: { risk?: string; paymentMethod?: string };
};
type ConfirmationData = {
  queue: ConfirmationOrder[]; rejected: ConfirmationOrder[]; candidates: ConfirmationOrder[];
  campaigns: Campaign[]; counts: { queue: number; rejected: number; approved: number };
};
type Mode = "queue" | "campaigns" | "rejected";
type OrderAction = "confirm" | "callback" | "unreachable" | "reject";

const emptyData: ConfirmationData = { queue: [], rejected: [], candidates: [], campaigns: [], counts: { queue: 0, rejected: 0, approved: 0 } };

function when(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function productSummary(products: ConfirmationOrder["products"]) {
  return products.length ? products.map((product) => `${product.name || product.sku || "Product"}${product.quantity ? ` ×${product.quantity}` : ""}`).join(", ") : "—";
}

export default function ConfirmationPanel({ active }: { active: boolean }) {
  const [mode, setMode] = useState<Mode>("queue");
  const [data, setData] = useState<ConfirmationData>(emptyData);
  const [loading, setLoading] = useState(true);
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
  const [campaignRisk, setCampaignRisk] = useState("all");
  const [campaignPayment, setCampaignPayment] = useState("all");
  const [autoAssign, setAutoAssign] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());

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
    if (!active) return;
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(true), 30000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [active, load]);

  async function post(payload: Record<string, unknown>) {
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
    const complete = await post({ action: "create_campaign", name: campaignName, description: campaignDescription, autoAssign, criteria: { risk: campaignRisk, paymentMethod: campaignPayment }, orderIds: [...selectedCandidates] });
    if (complete) { setCreateOpen(false); setCampaignName(""); setCampaignDescription(""); setSelectedCandidates(new Set()); }
  }

  async function moveCampaign(index: number, direction: -1 | 1) {
    const next = [...data.campaigns];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await post({ action: "reorder_campaigns", campaignIds: next.map((campaign) => campaign.id) });
  }

  const candidates = useMemo(() => {
    const query = candidateSearch.trim().toLowerCase();
    return data.candidates.filter((order) => {
      if (campaignRisk !== "all" && campaignRisk !== "high") return false;
      if (campaignPayment !== "all" && order.paymentMethod?.toLowerCase() !== campaignPayment) return false;
      return !query || [order.channelOrderId, order.customerName, order.customerPhone].some((value) => value?.toLowerCase().includes(query));
    });
  }, [campaignPayment, campaignRisk, candidateSearch, data.candidates]);

  return (
    <section className={`confirmation-view ${active ? "" : "view-hidden"}`}>
      <div className="confirmation-mode-tabs">
        <button className={mode === "queue" ? "active" : ""} onClick={() => setMode("queue")}><strong>Queue <b>{data.counts.queue}</b></strong><span>Orders waiting for confirmation</span></button>
        <button className={mode === "campaigns" ? "active" : ""} onClick={() => setMode("campaigns")}><strong>Campaigns <b>{data.campaigns.length}</b></strong><span>Automatic and manual assignment</span></button>
        <button className={mode === "rejected" ? "active rejected" : ""} onClick={() => setMode("rejected")}><strong>Rejected <b>{data.counts.rejected}</b></strong><span>Orders to cancel manually</span></button>
      </div>

      {error && <div className="error-banner"><span>!</span><p>{error}</p><button onClick={() => void load()}>Try again</button></div>}
      {loading ? <div className="confirmation-card confirmation-loading"><i className="loader"/><span>Loading confirmation workspace…</span></div> : null}

      {!loading && mode === "queue" && <article className="confirmation-card">
        <header className="confirmation-header"><div><p className="eyebrow">CONFIRMATION QUEUE</p><h2>High-RTO customer calls</h2><p>Orders are automatically assigned. Scheduled callbacks return when they are due.</p></div><span>{data.counts.approved} approved</span></header>
        {data.queue.length ? <div className="confirmation-orders">{data.queue.map((order) => <div className="confirmation-order" key={order.id}>
          <div className="confirmation-order-main"><strong>#{order.channelOrderId}</strong><small>{when(order.orderDate)} · {order.paymentMethod || "Payment unknown"} · ₹{Number(order.total || 0).toLocaleString("en-IN")}</small><p>{productSummary(order.products)}</p></div>
          <div><strong>{order.customerName || "Customer"}</strong><a href={`tel:${order.customerPhone}`}>{order.customerPhone || "No phone"}</a><small>{[order.customerAddress, order.customerCity, order.customerState, order.customerPincode].filter(Boolean).join(", ") || "No address"}</small></div>
          <div className="confirmation-meta"><span>{order.campaignName || "Confirmation"}</span><small>{order.attempts.length}/3 recall attempts</small>{order.attempts.at(-1) && <small>Last: {order.attempts.at(-1)?.outcome} · {when(order.attempts.at(-1)?.createdAt)}</small>}</div>
          <div className="confirmation-actions"><button className="positive" onClick={() => openAction(order, "confirm")}>Confirm</button><button onClick={() => openAction(order, "callback")}>Callback</button><button onClick={() => openAction(order, "unreachable")}>No answer</button><button className="danger" onClick={() => openAction(order, "reject")}>Reject</button></div>
        </div>)}</div> : <div className="confirmation-empty"><span>✓</span><h3>Queue is clear</h3><p>New high-RTO orders will appear here automatically.</p></div>}
      </article>}

      {!loading && mode === "rejected" && <article className="confirmation-card rejected-card">
        <header className="confirmation-header"><div><p className="eyebrow">REJECTED ORDERS</p><h2>Manual cancellation list</h2><p>These records are stored only in this dashboard. Shiprocket is never cancelled automatically.</p></div><span>{data.rejected.length} to review</span></header>
        {data.rejected.length ? <div className="confirmation-orders">{data.rejected.map((order) => { const latest = order.attempts.at(-1); return <div className="confirmation-order rejected-order" key={order.id}>
          <div className="confirmation-order-main"><strong>#{order.channelOrderId}</strong><small>Rejected {when(order.rejectedAt)}</small><p>{productSummary(order.products)}</p></div>
          <div><strong>{order.customerName || "Customer"}</strong><a href={`tel:${order.customerPhone}`}>{order.customerPhone || "No phone"}</a><small>{order.customerCity}, {order.customerState}</small></div>
          <div className="confirmation-meta"><span>{latest?.rejectionReason?.replaceAll("_", " ") || "Rejected"}</span><small>{latest?.note || "No note"}</small></div>
          <div className="manual-cancel-badge">Cancel manually in Shiprocket</div>
        </div>; })}</div> : <div className="confirmation-empty"><span>✓</span><h3>No rejected orders</h3><p>Customer cancellations and rejected confirmations will be retained here.</p></div>}
      </article>}

      {!loading && mode === "campaigns" && <div className="campaign-layout"><article className="confirmation-card">
        <header className="confirmation-header"><div><p className="eyebrow">CAMPAIGN PRIORITY</p><h2>Confirmation campaigns</h2><p>Higher campaigns are worked first. High RTO remains permanently automatic.</p></div><button className="campaign-create" onClick={() => setCreateOpen((value) => !value)}>{createOpen ? "Close" : "+ New campaign"}</button></header>
        <div className="campaign-list">{data.campaigns.map((campaign, index) => <div className={`campaign-row ${campaign.isActive ? "" : "inactive"}`} key={campaign.id}>
          <div className="campaign-rank">{index + 1}</div><div><strong>{campaign.name}{campaign.id === "cmp_default_high_rto" && <em>Permanent</em>}</strong><p>{campaign.description || "No description"}</p><small>{Number(campaign.orderCount)} assigned · {campaign.autoAssign ? "Automatic" : "Manual"}</small></div>
          <div className="campaign-row-actions"><button disabled={index === 0 || busy} onClick={() => void moveCampaign(index, -1)}>↑</button><button disabled={index === data.campaigns.length - 1 || busy} onClick={() => void moveCampaign(index, 1)}>↓</button>{campaign.id !== "cmp_default_high_rto" && campaign.isActive && <button className="danger" disabled={busy} onClick={() => void post({ action: "deactivate_campaign", campaignId: campaign.id })}>Deactivate</button>}</div>
        </div>)}</div>
      </article>

      {createOpen && <form className="confirmation-card campaign-form" onSubmit={createCampaign}>
        <header className="confirmation-header"><div><p className="eyebrow">NEW CAMPAIGN</p><h2>Create and assign</h2></div><button className="campaign-create" disabled={busy} type="submit">{busy ? "Saving…" : "Create campaign"}</button></header>
        <div className="campaign-fields"><label>Name<input required value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="e.g. COD verification"/></label><label>Description<input value={campaignDescription} onChange={(event) => setCampaignDescription(event.target.value)} placeholder="Optional context"/></label><label>Risk<select value={campaignRisk} onChange={(event) => setCampaignRisk(event.target.value)}><option value="all">All risk levels</option><option value="high">High RTO only</option></select></label><label>Payment<select value={campaignPayment} onChange={(event) => setCampaignPayment(event.target.value)}><option value="all">All payments</option><option value="cod">COD</option><option value="prepaid">Prepaid</option></select></label><label className="campaign-check"><input type="checkbox" checked={autoAssign} onChange={(event) => setAutoAssign(event.target.checked)}/>Auto-assign future matches</label></div>
        <div className="candidate-heading"><strong>Select current orders</strong><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Search order, customer or phone"/><button type="button" onClick={() => setSelectedCandidates(new Set(candidates.map((order) => order.id)))}>Select visible</button></div>
        <div className="candidate-list">{candidates.map((order) => <label key={order.id}><input aria-label={`Select order ${order.channelOrderId}`} type="checkbox" checked={selectedCandidates.has(order.id)} onChange={(event) => setSelectedCandidates((current) => { const next = new Set(current); if (event.target.checked) next.add(order.id); else next.delete(order.id); return next; })}/><span><strong>#{order.channelOrderId} · {order.customerName}</strong><small>{order.paymentMethod} · {order.campaignName || "Unassigned"}</small></span></label>)}</div>
      </form>}</div>}

      {selectedOrder && <div className="confirmation-modal-backdrop" role="button" tabIndex={0} aria-label="Close confirmation dialog" onKeyDown={(event) => event.key === "Escape" && !busy && setSelectedOrder(null)} onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setSelectedOrder(null); }}><form className="confirmation-modal" onSubmit={submitOrderAction}>
        <header><div><p className="eyebrow">ORDER #{selectedOrder.channelOrderId}</p><h2>{orderAction === "confirm" ? "Confirm customer order" : orderAction === "reject" ? "Reject confirmation" : orderAction === "callback" ? "Schedule callback" : "Record no answer"}</h2></div><button type="button" onClick={() => setSelectedOrder(null)}>×</button></header>
        {orderAction === "reject" && <div className="manual-warning"><strong>Dashboard record only</strong><span>You must cancel this order manually in Shiprocket.</span></div>}
        {orderAction === "callback" && <label>Callback time<input required type="datetime-local" value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)}/></label>}
        {orderAction === "reject" && <label>Reason<select value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)}><option value="customer_cancelled">Customer cancelled</option><option value="duplicate_order">Duplicate order</option><option value="incorrect_details">Incorrect details</option><option value="customer_unreachable">Customer unreachable</option><option value="other">Other</option></select></label>}
        <label>Call note<textarea required value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record what the customer said and any useful context" rows={4}/></label>
        <footer><button type="button" onClick={() => setSelectedOrder(null)}>Cancel</button><button className={orderAction === "reject" ? "danger" : "positive"} disabled={busy} type="submit">{busy ? "Saving…" : orderAction === "confirm" ? "Mark approved" : orderAction === "reject" ? "Add to rejected" : "Save attempt"}</button></footer>
      </form></div>}
    </section>
  );
}
