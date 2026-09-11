"use client";

import { useEffect, useMemo, useState } from "react";

type Metric = { count: number; percent: number };
type Breakdown = { name: string; total: number; delivered: number; outcomes: number; rate: number };
type OverviewData = {
  metrics: Record<string, Metric>;
  financials: { deliveredRevenue: number; avgShippingCost: number; avgDeliveredOrderValue: number; deliveredCount: number; shippingCostCount: number };
  risk: { high: Metric; low: Metric; unknown: Metric };
  byCourier: Breakdown[];
  byState: Breakdown[];
  ndrReasons: Array<{ reason: string; count: number }>;
  filterOptions: { couriers: string[]; states: string[] };
  dataQuality: { source: string; dateBasis: string; orderCount: number; lastSyncAt: string; syncStatus: string; lastSyncCount: number; lastSyncError: string };
};
type OfdOrder = {
  id: number; channelOrderId: string; customerName: string; customerCity: string; customerState: string;
  status: string; paymentMethod: string; total: number; awb: string; courier: string;
  shippedAt: string; firstOutForDeliveryAt: string; outForDeliveryAt: string; deliveredAt: string;
  ndrReason: string; ndrAttempts: number; ndrRaisedAt: string; shippingCost: number;
  attemptNumber: number; previousUndelivered: boolean;
};
type OfdData = { date: string; metrics: Record<string, Metric>; trackingHistory: { status: string; error?: string }; orders: OfdOrder[] };

const formatCurrency = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value || 0);
const formatDateTime = (value: string) => value ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
const indiaDateValue = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

function MetricCard({ label, metric, hint }: { label: string; metric?: Metric; hint?: string }) {
  return <article className="metric-card" title={hint}><p>{label}</p><strong>{metric ? <>{metric.percent}% <span>({metric.count})</span></> : "—"}</strong></article>;
}

function RateChart({ title, subtitle, rows }: { title: string; subtitle: string; rows: Breakdown[] }) {
  return <section className="analytics-card chart-card">
    <header><div><h2>{title}</h2><p>{subtitle}</p></div></header>
    <div className="bar-list">
      {rows.map((row) => <div className="bar-row" key={row.name}>
        <div><strong title={row.name}>{row.name}</strong><span>{row.rate}% <small>({row.delivered}/{row.outcomes})</small></span></div>
        <div className="bar-track"><i style={{ width: `${Math.max(1, row.rate)}%` }} /></div>
      </div>)}
      {rows.length === 0 && <p className="analytics-empty">No completed delivery outcomes in this period.</p>}
    </div>
  </section>;
}

export default function AnalyticsPanel({ mode, active, preview=false }: { preview?:boolean; mode: "overview" | "today_ofd"; active: boolean }) {
  const today = useMemo(() => indiaDateValue(new Date()), []);
  const monthAgo = useMemo(() => { const date = new Date(); date.setDate(date.getDate() - 29); return indiaDateValue(date); }, []);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [payment, setPayment] = useState("");
  const [courier, setCourier] = useState("");
  const [state, setState] = useState("");
  const [risk, setRisk] = useState("");
  const [analyticsView, setAnalyticsView] = useState<"closed" | "open">("closed");
  const [ofdDate, setOfdDate] = useState(today);
  const [ofdOutcome, setOfdOutcome] = useState<"all" | "delivered" | "undelivered" | "out" | "unresolved" | "attempt1" | "attempt2" | "attempt3">("all");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [ofd, setOfd] = useState<OfdData | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ mode });
    if (mode === "today_ofd") params.set("date", ofdDate);
    else {
      if (from) params.set("from", from); if (to) params.set("to", to);
      if (payment) params.set("payment", payment); if (courier) params.set("courier", courier);
      if (state) params.set("state", state); if (risk) params.set("risk", risk);
    }
    return params.toString();
  }, [mode, ofdDate, from, to, payment, courier, state, risk]);

  useEffect(() => {
    if (!active || preview) return;
    let live = true;
    const load = async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const response = await fetch(`/api/analytics?${query}`, { cache: "no-store" });
        const payload = await response.json() as (OverviewData | OfdData) & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load analytics");
        if (!live) return;
        if (mode === "overview") setOverview(payload as OverviewData); else setOfd(payload as OfdData);
        setError("");
      } catch (loadError) {
        if (live) setError(loadError instanceof Error ? loadError.message : "Could not load analytics");
      } finally { if (live && !quiet) setLoading(false); }
    };
    void load();
    const interval = window.setInterval(() => void load(true), 15000);
    return () => { live = false; window.clearInterval(interval); };
  }, [active, mode, query, preview]);

  if (mode === "today_ofd") {
    const metrics = ofd?.metrics || {};
    const historical = ofdDate < today;
    const shownOrders = (ofd?.orders || []).filter((order) => {
      if (ofdOutcome === "delivered") return /^(DELIVERED|DELIVERED TO CUSTOMER)$/i.test(order.status);
      if (ofdOutcome === "undelivered") return /UNDELIVERED|NDR|RTO|RETURN TO ORIGIN/i.test(order.status);
      if (ofdOutcome === "out") return /^OUT FOR DELIVERY$/i.test(order.status);
      if (ofdOutcome === "unresolved") return /^UNRESOLVED AFTER OFD$/i.test(order.status);
      if (ofdOutcome.startsWith("attempt")) return order.attemptNumber === Number(ofdOutcome.slice(-1));
      return true;
    });
    return <section className={`analytics-view ${!active ? "view-hidden" : ""}`}>
      <div className="analytics-filter ofd-filter"><label>OFD date<input type="date" value={ofdDate} max={today} onChange={(event) => setOfdDate(event.target.value)} /></label></div>
      {error && <div className="error-banner"><span>!</span><p>{error}</p></div>}
      {ofd?.trackingHistory.status === "error" && <div className="error-banner"><span>!</span><p>Shiprocket tracking history could not be refreshed: {ofd.trackingHistory.error}. Attempt counts shown below may be incomplete.</p></div>}
      <div className="metrics-grid ofd-metrics">
        <MetricCard label="Went out for delivery" metric={metrics.total} />
        <MetricCard label="Delivered" metric={metrics.delivered} />
        <MetricCard label="Undelivered" metric={metrics.undelivered} />
        <MetricCard label="Still out for delivery" metric={metrics.stillOut} hint={historical ? "Past dates cannot remain in this category" : "Live current-day status"} />
        <MetricCard label="1st recorded OFD day" metric={metrics.firstAttemptOFD} />
        <MetricCard label="2nd recorded OFD day" metric={metrics.secondAttemptOFD} />
        <MetricCard label="3rd recorded OFD day" metric={metrics.thirdAttemptOFD} />
        <MetricCard label="Unresolved after OFD" metric={metrics.unresolved} hint="Past-date orders without a closing delivery scan" />
        {(metrics.unknownAttemptOFD?.count || 0) > 0 && <MetricCard label="History unavailable" metric={metrics.unknownAttemptOFD} />}
        <MetricCard label="Previously undelivered" metric={metrics.previousUndelivered} />
        <MetricCard label="Moved to RTO" metric={metrics.rto} />
        {(metrics.laterAttemptOFD?.count || 0) > 0 && <MetricCard label="4+ recorded OFD days" metric={metrics.laterAttemptOFD} />}
      </div>
      <section className="analytics-card ofd-orders-card">
        <header><div><h2>OFD register</h2><span className="record-count" title="Counts use distinct recorded OFD dates in India. Missing history and repeated attempts on the same day mean these are not verified courier attempt numbers.">Recorded scans</span><p>{historical ? "Latest known outcome; old OFD scans without closure move to Unresolved after OFD." : "Live attempt number, current outcome, and NDR detail"} for {ofdDate}.</p></div><span className="record-count">{shownOrders.length} orders</span></header>
        <nav className="outcome-tabs" aria-label="Filter OFD outcomes">{([['all','All'],['delivered','Delivered'],['undelivered','Undelivered / RTO'],['out','Still OFD'],['unresolved','Unresolved after OFD'],['attempt1','1st recorded day'],['attempt2','2nd recorded day'],['attempt3','3rd recorded day']] as const).map(([key,label])=><button key={key} className={ofdOutcome===key?'active':''} onClick={()=>setOfdOutcome(key)}>{label}</button>)}</nav>
        <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Order</th><th>Recorded OFD day</th><th>Customer</th><th>OFD time</th><th>First OFD</th><th>Current outcome</th><th>NDR reason</th><th>AWB / Courier</th><th>Amount</th></tr></thead><tbody>
          {shownOrders.map((order) => <tr key={order.id}><td><strong>#{order.channelOrderId || order.id}</strong>{order.previousUndelivered && <small className="repeat-attempt">Previous attempt failed</small>}</td><td><strong className="attempt-number">{order.attemptNumber || "Unknown"}</strong></td><td><strong>{order.customerName || "—"}</strong><small>{[order.customerCity, order.customerState].filter(Boolean).join(", ")}</small></td><td>{formatDateTime(order.outForDeliveryAt)}</td><td>{formatDateTime(order.firstOutForDeliveryAt)}</td><td><span className="analytics-status">{order.status || "Unknown"}</span>{order.deliveredAt && <small>Delivered {formatDateTime(order.deliveredAt)}</small>}</td><td><strong>{order.ndrReason || "—"}</strong>{order.ndrRaisedAt && <small>{formatDateTime(order.ndrRaisedAt)}</small>}</td><td><strong>{order.awb || "—"}</strong><small>{order.courier || "Not assigned"}</small></td><td><strong>{formatCurrency(order.total)}</strong>{order.shippingCost > 0 && <small>Ship {formatCurrency(order.shippingCost)}</small>}</td></tr>)}
        </tbody></table>{loading && <div className="analytics-loading"><span className="loader" />Loading live OFD activity…</div>}{!loading && !error && !(ofd?.orders.length) && <div className="analytics-empty large">No orders went out for delivery on this date.</div>}</div>
      </section>
    </section>;
  }

  const metrics = overview?.metrics || {};
  const delivered = analyticsView === "closed" ? metrics.deliveryRate?.percent || 0 : metrics.openDeliveryRate?.percent || 0;
  const rto = analyticsView === "closed" ? metrics.closedRto?.percent || 0 : 0;
  const ndr = analyticsView === "closed" ? metrics.closedNdr?.percent || 0 : metrics.inTransit?.percent || 0;
  const other = Math.max(0, 100 - delivered - rto - ndr);
  const maxReason = Math.max(1, ...(overview?.ndrReasons || []).map((item) => Number(item.count)));
  return <section className={`analytics-view ${!active ? "view-hidden" : ""}`}>
    <div className="analytics-filter">
      <label>Order date from<input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Order date to<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label>
      <label>Payment<select value={payment} onChange={(event) => setPayment(event.target.value)}><option value="">All payments</option><option value="prepaid">Prepaid</option><option value="cod">COD</option></select></label>
      <label>Courier<select value={courier} onChange={(event) => setCourier(event.target.value)}><option value="">All couriers</option>{overview?.filterOptions.couriers.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>State<select value={state} onChange={(event) => setState(event.target.value)}><option value="">All states</option>{overview?.filterOptions.states.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>RTO risk<select value={risk} onChange={(event) => setRisk(event.target.value)}><option value="">All risk</option><option value="low">Low risk</option><option value="high">High / very high</option></select></label>
      <button onClick={() => { setFrom(monthAgo); setTo(today); setPayment(""); setCourier(""); setState(""); setRisk(""); }}>Reset</button>
    </div>
    {error && <div className="error-banner"><span>!</span><p>{error}</p></div>}
    {overview && <div className={`analytics-data-quality ${overview.dataQuality.syncStatus === "healthy" ? "healthy" : "warning"}`}>
      <i /><span><strong>{overview.dataQuality.orderCount} real orders in this view</strong> · {overview.dataQuality.source} · {overview.dataQuality.dateBasis} · {overview.dataQuality.lastSyncAt ? `Last sync ${formatDateTime(overview.dataQuality.lastSyncAt)}` : "No completed sync timestamp"}{overview.dataQuality.lastSyncError ? ` · Sync warning: ${overview.dataQuality.lastSyncError}` : ""}</span>
    </div>}
    <nav className="analytics-mode-tabs" aria-label="Analytics calculation view">
      <button className={analyticsView === "closed" ? "active" : ""} onClick={() => setAnalyticsView("closed")}><strong>Attempted outcomes</strong><span>Delivered ÷ (Delivered + RTO + Undelivered) × 100</span></button>
      <button className={analyticsView === "open" ? "active" : ""} onClick={() => setAnalyticsView("open")}><strong>Open delivery view</strong><span>Delivered ÷ (Delivered + In transit) × 100 · Undelivered attempts excluded</span></button>
    </nav>
    <div className="metrics-grid">
      {analyticsView === "closed" ? <>
        <MetricCard label="Closed delivery rate" metric={metrics.deliveryRate} hint="Delivered ÷ closed outcomes" />
        <MetricCard label="Delivered" metric={metrics.deliveryRate} hint="Within closed outcomes" />
        <MetricCard label="RTO" metric={metrics.closedRto} hint="Within closed outcomes" />
        <MetricCard label="Undelivered" metric={metrics.closedNdr} hint="Within closed outcomes" />
        <MetricCard label="Closed population" metric={metrics.closed} />
        <MetricCard label="Prepaid" metric={metrics.prepaid} />
      </> : <>
        <MetricCard label="Open delivery rate" metric={metrics.openDeliveryRate} hint="Delivered ÷ (Delivered + In transit)" />
        <MetricCard label="Open population" metric={metrics.openPopulation} hint="Delivered + In transit" />
        <MetricCard label="In transit" metric={metrics.inTransit} hint="Includes OFD; excludes undelivered attempts" />
        <MetricCard label="All historically shipped" metric={metrics.shipped} hint="Reference count only" />
        <MetricCard label="Non-shipped" metric={metrics.nonShipped} />
        <MetricCard label="Cancelled" metric={metrics.cancelled} />
      </>}
    </div>
    <div className="analytics-grid overview-grid">
      <section className="analytics-card outcome-card"><header><div><h2>{analyticsView === "closed" ? "Attempted outcome mix" : "Open delivery mix"}</h2><p>{analyticsView === "closed" ? "Delivered, RTO, and attempted-undelivered orders" : "Delivered and currently in-transit orders only"}</p></div></header><div className="donut-layout"><div className="donut" style={{ background: `conic-gradient(#46d495 0 ${delivered}%, #ff706b ${delivered}% ${delivered + rto}%, #f0aa5c ${delivered + rto}% ${delivered + rto + ndr}%, #27302c ${delivered + rto + ndr}% 100%)` }}><span><strong>{analyticsView === "closed" ? metrics.closed?.count || 0 : metrics.openPopulation?.count || 0}</strong><small>{analyticsView === "closed" ? "closed" : "open population"}</small></span></div><div className="legend"><span><i className="delivered" />Delivered <b>{delivered}%</b></span>{analyticsView === "closed" && <span><i className="rto" />RTO <b>{rto}%</b></span>}<span><i className="ndr" />{analyticsView === "closed" ? "Undelivered" : "In transit"} <b>{ndr}%</b></span>{other > 0 && <span><i />Rounding <b>{Math.round(other * 10) / 10}%</b></span>}</div></div></section>
      <section className="analytics-card finance-card"><header><div><h2>Revenue & cost</h2><p>Calculated only from delivered orders in the selected order-date cohort</p></div></header><div className="finance-list"><div><span>Delivered revenue</span><strong>{formatCurrency(overview?.financials.deliveredRevenue || 0)}</strong><small>Sum of {overview?.financials.deliveredCount || 0} delivered order totals</small></div><div><span>Avg. delivered shipping cost</span><strong>{overview?.financials.shippingCostCount ? formatCurrency(overview.financials.avgShippingCost) : "Not reported"}</strong><small>{overview?.financials.shippingCostCount || 0} delivered orders report shipping cost</small></div><div><span>Avg. delivered order value</span><strong>{overview?.financials.deliveredCount ? formatCurrency(overview.financials.avgDeliveredOrderValue) : "Not reported"}</strong><small>Delivered order totals only</small></div><div><span>COD share</span><strong>{metrics.cod?.percent || 0}% <small>({metrics.cod?.count || 0})</small></strong><small>All orders in this view</small></div></div></section>
      <section className="analytics-card risk-card"><header><div><h2>RTO risk split</h2><p>Tagged orders only · {overview?.risk.unknown.count || 0} orders have no recognised risk tag</p></div></header><div className="risk-split"><div><span>Low risk</span><strong>{overview?.risk.low.percent || 0}% <small>({overview?.risk.low.count || 0})</small></strong><i><b style={{ width: `${overview?.risk.low.percent || 0}%` }} /></i></div><div className="high"><span>High / very high</span><strong>{overview?.risk.high.percent || 0}% <small>({overview?.risk.high.count || 0})</small></strong><i><b style={{ width: `${overview?.risk.high.percent || 0}%` }} /></i></div></div></section>
      <section className="analytics-card ndr-card"><header><div><h2>NDR reasons</h2><p>Why delivery attempts failed</p></div></header><div className="reason-list">{(overview?.ndrReasons || []).map((item) => <div key={item.reason}><span title={item.reason}>{item.reason}</span><i><b style={{ width: `${(Number(item.count) / maxReason) * 100}%` }} /></i><strong>{item.count}</strong></div>)}{!overview?.ndrReasons.length && <p className="analytics-empty">No NDR orders in this period.</p>}</div></section>
      <RateChart title="Delivery % by courier" subtitle="Delivered ÷ final outcomes; highest-volume couriers first" rows={overview?.byCourier || []} />
      <RateChart title="Delivery % by state" subtitle="Delivered ÷ final outcomes; highest-volume states first" rows={overview?.byState || []} />
    </div>
    {loading && !overview && <div className="analytics-loading"><span className="loader" />Calculating analytics…</div>}
  </section>;
}
