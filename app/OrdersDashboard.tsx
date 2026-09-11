"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { readJson } from "../lib/http";
import Image from "next/image";
import Link from "next/link";
import { Boxes, ChevronLeft, ChevronRight, LayoutDashboard, PackageSearch, PhoneCall, RotateCcw, Search, ShoppingBag, Truck, UsersRound, Warehouse } from "lucide-react";
import { statusTab } from "../lib/order-status";
import AnalyticsPanel from "./AnalyticsPanel";
import ConfirmationPanel from "./ConfirmationPanel";
import ReportsPanel from "./ReportsPanel";
import AccountMenu from "./AccountMenu";
import InventoryPanel from "./InventoryPanel";
import SupportPanel from "./SupportPanel";
import LiveStatus from "./LiveStatus";

type TabKey = "new" | "ready" | "shipped" | "out_for_delivery" | "undelivered" | "delivered" | "rto" | "all";
type RiskKey = "all" | "low" | "high" | "approved";
type Order = {
  id: number; channelOrderId: string; channelName: string; customerName: string;
  customerEmail: string; customerPhone: string; customerCity: string; customerState: string;
  orderDate: string; deliveredAt: string; status: string; paymentMethod: string; paymentStatus: string;
  total: number; pickupLocation: string; awb: string; courier: string;
  products: Array<{ name?: string; sku?: string; quantity?: number }>; syncedAt: string;
  confirmationStatus?: string; confirmationUpdatedAt?: string; confirmedAt?: string; rejectedAt?: string;
};
type OrdersResponse = {
  orders: Order[];
  counts: Record<TabKey, number>;
  riskCounts: Record<RiskKey, number>;
  total: number; page: number; perPage: number; totalPages: number;
  sync: Record<string, string>;
  filterOptions: { couriers: string[]; pickups: string[] };
};
type ActivityLog = {
  id: number; source: string; eventType: string; level: string;
  message: string; details: Record<string, unknown>; createdAt: string;
};
type LogsResponse = { logs: ActivityLog[]; sync: Record<string, string> };
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "new", label: "New" }, { key: "ready", label: "Ready to ship" },
  { key: "shipped", label: "Shipped" }, { key: "out_for_delivery", label: "Out for delivery" },
  { key: "undelivered", label: "Undelivered" }, { key: "delivered", label: "Delivered" },
  { key: "rto", label: "RTO" }, { key: "all", label: "All" },
];

const emptyData: OrdersResponse = {
  orders: [], counts: { new: 0, ready: 0, shipped: 0, out_for_delivery: 0, undelivered: 0, delivered: 0, rto: 0, all: 0 },
  riskCounts: { all: 0, low: 0, high: 0, approved: 0 },
  total: 0, page: 1, perPage: 50, totalPages: 1, sync: {},
  filterOptions: { couriers: [], pickups: [] },
};

function formatDate(value: string) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

const formatCurrency = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
const statusClass = (status: string) => statusTab(status);
const indiaDateValue = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const todayValue = indiaDateValue(new Date());

export default function OrdersDashboard({ userLabel, userEmail, userRole, isAdmin, preview = false }: { userLabel: string; userEmail: string; userRole: string; isAdmin: boolean; preview?: boolean }) {
  const [view, setView] = useState<"orders" | "confirmation" | "campaigns" | "inventory" | "support" | "analytics" | "today_ofd" | "reports" | "logs">(preview ? "inventory" : "orders");
  useEffect(() => { const timer=setTimeout(() => { if (new URLSearchParams(window.location.search).get("view") === "support") setView("support"); },0); return () => clearTimeout(timer); }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tab, setTab] = useState<TabKey>("new");
  const [risk, setRisk] = useState<RiskKey>("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [payment, setPayment] = useState("");
  const [courier, setCourier] = useState("");
  const [pickup, setPickup] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [deliveredDate, setDeliveredDate] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [filterOpen, setFilterOpen] = useState(false);
  const [data, setData] = useState<OrdersResponse>(emptyData);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<Map<number, string>>(new Map());
  const [selectingAll, setSelectingAll] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [logsData, setLogsData] = useState<LogsResponse>({ logs: [], sync: {} });
  const [logsLoading, setLogsLoading] = useState(true);

  const query = useMemo(() => {
    if (risk === "approved") return new URLSearchParams({ risk, page: String(page) }).toString();
    const params = new URLSearchParams({ tab, risk, page: String(page), sort });
    if (deferredSearch) params.set("search", deferredSearch);
    if (payment) params.set("payment", payment);
    if (courier) params.set("courier", courier);
    if (pickup) params.set("pickup", pickup);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (tab === "delivered" && deliveredDate) params.set("delivered_date", deliveredDate);
    return params.toString();
  }, [tab, risk, page, sort, deferredSearch, payment, courier, pickup, from, to, deliveredDate]);

  const currentQuery=useRef(query);
  useEffect(()=>{currentQuery.current=query;},[query]);
  const loading = !preview && !loadedQuery && !error;
  const changingQuery = !!loadedQuery && loadedQuery !== query;

  async function loadOrders() {
    if (preview) return;
    setError("");
    try {
      const response = await fetch(`/api/orders?${query}`, { cache: "no-store" });
      const payload = await readJson(response) as OrdersResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load orders");
      if(currentQuery.current!==query)return;
      setData(payload);
      setLoadedQuery(query);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load orders");
    }
  }

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    fetch(`/api/orders?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await readJson(response) as OrdersResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load orders");
        return payload;
      })
      .then((payload) => {
        setData(payload);
        setLoadedQuery(query);
        setSelectedOrders(new Map());
        setCopyState("idle");
        setError("");
      })
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") setError(loadError.message || "Could not load orders");
      });
    return () => controller.abort();
  }, [query, preview]);

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    fetch("/api/logs", { signal: controller.signal, cache: "no-store" })
      .then((response) => readJson<LogsResponse>(response))
      .then((payload: LogsResponse) => setLogsData(payload))
      .catch((logsError: Error) => { if (logsError.name !== "AbortError") setError(logsError.message); })
      .finally(() => setLogsLoading(false));
    return () => controller.abort();
  }, [preview]);

  useEffect(() => {
    if (preview) return;
    if (view !== "logs") return;
    const interval = window.setInterval(() => {
      fetch("/api/logs", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload: LogsResponse | null) => { if (payload) setLogsData(payload); })
        .catch(() => { /* Keep the last successful live snapshot. */ });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [view, preview]);

  useEffect(() => {
    if (preview) return;
    if (view !== "orders") return;
    const controller=new AbortController();
    let running=false;
    const refresh=async()=>{
      if(running)return;running=true;
      try{
        const response=await fetch(`/api/orders?${query}`,{cache:"no-store",signal:controller.signal});
        const payload=await readJson<OrdersResponse>(response);
        if(!controller.signal.aborted && currentQuery.current===query){setData(payload);setLoadedQuery(query);}
      }catch{/* Preserve the visible snapshot during a background failure. */}
      finally{running=false;}
    };
    const interval=window.setInterval(()=>void refresh(),10000);
    return()=>{controller.abort();window.clearInterval(interval);};
  }, [query, view, preview]);

  async function loadLogs() {
    if (preview) return;
    setLogsLoading(true);
    try {
      const response = await fetch("/api/logs", { cache: "no-store" });
      const payload = await readJson(response) as LogsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load activity logs");
      setLogsData(payload);
    } catch (logsError) {
      setError(logsError instanceof Error ? logsError.message : "Could not load activity logs");
    } finally {
      setLogsLoading(false);
    }
  }

  async function syncNow() {
    if (preview) return;
    setSyncing(true);
    setError("");
    try {
      let page: number | undefined;
      let mode: "incremental" | "full" = "incremental";
      do {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json", "x-requested-with": "satmi-orders-dashboard" },
          body: JSON.stringify({ mode, page }),
        });
        const payload = await readJson(response) as { error?: string; mode?: "incremental" | "full"; hasMore?: boolean; nextPage?: number };
        if (!response.ok) throw new Error(payload.error || "Sync failed");
        if (payload.mode === "full") mode = "full";
        page = payload.hasMore ? payload.nextPage : undefined;
        await loadOrders();
      } while (page);
      await Promise.all([loadOrders(), loadLogs()]);
      setView("reports");
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  function clearFilters() {
    setPayment(""); setCourier(""); setPickup(""); setFrom(""); setTo(""); setDeliveredDate(""); setPage(1);
  }

  function applyRecentDays(days: number) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    setFrom(indiaDateValue(start));
    setTo(indiaDateValue(end));
    setPage(1);
  }

  function applyYesterday() {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const value = indiaDateValue(yesterday);
    setFrom(value);
    setTo(value);
    setPage(1);
  }

  function toggleOrder(order: Order) {
    setSelectedOrders((current) => {
      const next = new Map(current);
      if (next.has(order.id)) next.delete(order.id);
      else next.set(order.id, String(order.channelOrderId || order.id));
      return next;
    });
    setCopyState("idle");
  }

  function toggleAllVisible() {
    const allSelected = data.orders.length > 0 && data.orders.every((order) => selectedOrders.has(order.id));
    setSelectedOrders((current) => {
      const next = new Map(current);
      for (const order of data.orders) {
        if (allSelected) next.delete(order.id);
        else next.set(order.id, String(order.channelOrderId || order.id));
      }
      return next;
    });
    setCopyState("idle");
  }

  async function toggleAllResults() {
    if (data.total > 0 && selectedOrders.size === data.total) {
      setSelectedOrders(new Map());
      setCopyState("idle");
      return;
    }
    setSelectingAll(true);
    setError("");
    try {
      const params = new URLSearchParams(query);
      params.delete("page");
      params.set("selection", "all");
      const response = await fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });
      const payload = await readJson(response) as { orders?: Array<{ id: number; channelOrderId: string }>; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not select all orders");
      setSelectedOrders(new Map((payload.orders || []).map((order) => [order.id, String(order.channelOrderId || order.id)])));
      setCopyState("idle");
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "Could not select all orders");
    } finally {
      setSelectingAll(false);
    }
  }

  async function copySelectedOrderIds() {
    const value = Array.from(selectedOrders.values())
      .map((orderId) => orderId.replace(/^#+/, "").replace(/\s+/g, ""))
      .join(",");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setError("Could not copy order IDs. Please allow clipboard access and try again.");
    }
  }

  const appliedFilters = [payment, courier, pickup, from, to, tab === "delivered" ? deliveredDate : ""].filter(Boolean).length;
  const visibleIds = data.orders.map((order) => order.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedOrders.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedOrders.has(id));
  const allResultsSelected = data.total > 0 && selectedOrders.size === data.total;
  const viewCopy = {
    orders: { eyebrow: "Order management", title: "Orders" },
    confirmation: { eyebrow: "Customer verification", title: "Confirmation" },
    campaigns: { eyebrow: "Customer verification", title: "Campaigns" },
    support: { eyebrow: "Customer care", title: "Customer support" },
    inventory: { eyebrow: "Stock control", title: "Inventory" },
    analytics: { eyebrow: "Performance intelligence", title: "Analytics" },
    today_ofd: { eyebrow: "Delivery operations", title: "Today’s OFD" },
    reports: { eyebrow: "Reconciliation archive", title: "Reports" },
    logs: { eyebrow: "Live activity", title: "Activity log" },
  }[view];
  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Dashboard sections">
        <div className="sidebar-brand"><Image className="sidebar-brand-logo" src="/satmi-logo.png" alt="Satmi" width={112} height={74} priority/></div>
        <div className="sidebar-heading"><p>Workspace</p><button className="sidebar-toggle" aria-label={sidebarCollapsed ? "Expand side menu" : "Collapse side menu"} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <ChevronRight size={15}/> : <ChevronLeft size={15}/>}</button></div>
        <button title="Orders" className={view === "orders" ? "active" : ""} onClick={() => setView("orders")}><ShoppingBag/><strong>Orders</strong></button>
        <button title="Confirmation" className={view === "confirmation" ? "active" : ""} onClick={() => setView("confirmation")}><PhoneCall/><strong>Confirmation</strong></button>
        <button title="Campaigns" className={view === "campaigns" ? "active" : ""} onClick={() => setView("campaigns")}><Boxes/><strong>Campaigns</strong></button>
        <button title="Inventory" className={view === "inventory" ? "active" : ""} onClick={() => setView("inventory")}><Warehouse/><strong>Inventory</strong></button>
        {(isAdmin || ["support_agent", "support_manager"].includes(userRole)) && <button title="Customer support" className={view === "support" ? "active" : ""} onClick={() => setView("support")}><UsersRound/><strong>Customer support</strong></button>}
        <button title="Analytics" className={view === "analytics" ? "active" : ""} onClick={() => setView("analytics")}><LayoutDashboard/><strong>Analytics</strong></button>
        <button title="Today’s OFD" className={view === "today_ofd" ? "active" : ""} onClick={() => setView("today_ofd")}><Truck/><strong>Today’s OFD</strong></button>
        <button title="Reports" className={view === "reports" ? "active" : ""} onClick={() => setView("reports")}><PackageSearch/><strong>Reports</strong></button>
        <button title="Activity log" className={view === "logs" ? "active" : ""} onClick={() => { setView("logs"); void loadLogs(); }}><RotateCcw/><strong>Activity log</strong></button>
        {isAdmin && <Link href="/admin/users" title="Manage users"><UsersRound/><strong>Manage users</strong></Link>}
      </aside>

      <div className="app-main">
      <header className="topbar">
        <div className="header-context"><div><p className="eyebrow">{viewCopy.eyebrow}</p><h1>{viewCopy.title}</h1></div><span className="role-badge">{userRole === "admin" ? "Administrator" : "Operations"}</span></div>
        <div className="header-tools">
          <label className="header-search"><Search size={17}/><input value={search} onChange={(event) => { setSearch(event.target.value); setView("orders"); setPage(1); }} placeholder="Search orders, customers, AWB or SKU" aria-label="Search dashboard"/></label>
          <LiveStatus preview={preview} />
          <AccountMenu preview={preview} name={userLabel} email={userEmail} isAdmin={isAdmin} />
        </div>
      </header>

      <section className="workspace">
        {view === "orders" && <div className="page-heading"><button className="sync-button" onClick={syncNow} disabled={syncing || preview}>{syncing ? "Syncing…" : "Sync now"}</button></div>}

        {error && <div className="error-banner"><span>!</span><p>{error}</p><button onClick={() => loadOrders()}>Try again</button></div>}

        <section className={`orders-card ${view !== "orders" ? "view-hidden" : ""}`}>
          <nav className="tabs" aria-label="Order status">
            {tabs.map((item) => (
              <button key={item.key} className={tab === item.key && risk !== "approved" ? "active" : ""} onClick={() => { setTab(item.key); if (risk === "approved") setRisk("all"); setPage(1); }}>
                {item.label}<span>{data.counts[item.key]}</span>
              </button>
            ))}
          </nav>

          <nav className="risk-tabs" aria-label="RTO risk">
            <button className={risk === "all" ? "active" : ""} onClick={() => { setRisk("all"); setPage(1); }}>
              All <span>{data.riskCounts.all}</span>
            </button>
            <button className={risk === "low" ? "active" : ""} onClick={() => { setRisk("low"); setPage(1); }}>
              <i />Low risk <span>{data.riskCounts.low}</span>
            </button>
            <button className={risk === "high" ? "active high" : "high"} onClick={() => { setRisk("high"); setPage(1); }}>
              <i />High risk <span>{data.riskCounts.high}</span>
            </button>
            {tab === "new" && <button className={risk === "approved" ? "active approved" : "approved"} onClick={() => { setRisk("approved"); setFilterOpen(false); setPage(1); }}>
              <i />Approved <span>{data.riskCounts.approved}</span>
            </button>}
          </nav>

          {risk !== "approved" && tab === "delivered" && (
            <div className="delivery-date-filter">
              <label><span>Delivered date</span><input type="date" value={deliveredDate} max={todayValue} onChange={(event) => { setDeliveredDate(event.target.value); setPage(1); }} /></label>
              {deliveredDate && <button onClick={() => { setDeliveredDate(""); setPage(1); }}>Clear date</button>}
            </div>
          )}

          {risk !== "approved" && <div className="toolbar">
            <div className="toolbar-actions">
              <label className="sort-control"><span>Sort</span><select value={sort} onChange={(event) => { setSort(event.target.value as "newest" | "oldest"); setPage(1); }} aria-label="Sort orders by order date"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
              <button className={`filter-button ${filterOpen ? "active" : ""}`} onClick={() => setFilterOpen((value) => !value)}>
                Filters{appliedFilters > 0 && <b>{appliedFilters}</b>}<span>＋</span>
              </button>
            </div>
          </div>}

          {risk !== "approved" && filterOpen && (
            <div className="filter-panel">
              <label>Payment<select value={payment} onChange={(event) => { setPayment(event.target.value); setPage(1); }}><option value="">All payments</option><option value="prepaid">Prepaid</option><option value="cod">COD</option></select></label>
              <label>Courier<select value={courier} onChange={(event) => { setCourier(event.target.value); setPage(1); }}><option value="">All couriers</option>{data.filterOptions.couriers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>Pickup location<select value={pickup} onChange={(event) => { setPickup(event.target.value); setPage(1); }}><option value="">All locations</option>{data.filterOptions.pickups.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>From<input type="date" value={from} max={to || todayValue} onChange={(event) => { const value = event.target.value; setFrom(value); if (to && value > to) setTo(value); setPage(1); }} /></label>
              <label>To<input type="date" value={to} min={from || undefined} max={todayValue} onChange={(event) => { const value = event.target.value; setTo(value); if (from && value < from) setFrom(value); setPage(1); }} /></label>
              <button className="clear-button" onClick={clearFilters} disabled={!appliedFilters}>Clear filters</button>
              <div className="date-presets"><span>Quick date</span><button onClick={() => applyRecentDays(1)}>Today</button><button onClick={applyYesterday}>Yesterday</button><button onClick={() => applyRecentDays(7)}>Last 7 days</button><button onClick={() => applyRecentDays(30)}>Last 30 days</button></div>
            </div>
          )}

          <div className="selection-controls">
            <label><input type="checkbox" checked={allResultsSelected} ref={(element) => { if (element) element.indeterminate = selectedOrders.size > 0 && !allResultsSelected; }} onChange={toggleAllResults} disabled={selectingAll || loading || changingQuery || data.total === 0} /><span>{selectingAll ? "Selecting…" : `All pages (${data.total})`}</span></label>
            <label><input type="checkbox" checked={allVisibleSelected} ref={(element) => { if (element) element.indeterminate = someVisibleSelected && !allVisibleSelected; }} onChange={toggleAllVisible} disabled={loading || changingQuery || data.orders.length === 0} /><span>This page ({data.orders.length})</span></label>
          </div>

          {selectedOrders.size > 0 && (
            <div className="selection-bar">
              <strong>{selectedOrders.size} selected</strong>
              <button onClick={copySelectedOrderIds}>{copyState === "copied" ? "Copied!" : "Copy order IDs"}</button>
              <button className="selection-clear" onClick={() => setSelectedOrders(new Map())}>Clear</button>
            </div>
          )}

          <div className="table-wrap" aria-busy={changingQuery}>
            <table>
              <thead><tr><th>Order</th><th>Customer</th><th>Products</th><th>Order date</th><th>Payment</th><th>Amount</th><th>Status</th><th>AWB / Courier</th></tr></thead>
              <tbody>
                {!loading && data.orders.map((order) => {
                  const firstProduct = order.products[0];
                  return (
                    <tr key={order.id} className={selectedOrders.has(order.id) ? "selected" : ""}>
                      <td data-label="Order"><div className="order-cell"><input type="checkbox" checked={selectedOrders.has(order.id)} onChange={() => toggleOrder(order)} aria-label={`Select order ${order.channelOrderId || order.id}`} /><span><strong>#{order.channelOrderId || order.id}</strong><small>{order.channelName || "Shopify_5"}</small></span></div></td>
                      <td data-label="Customer"><strong>{order.customerName || "—"}</strong><small>{[order.customerCity, order.customerState].filter(Boolean).join(", ") || order.customerPhone || "—"}</small></td>
                      <td data-label="Products"><strong>{firstProduct?.name || "—"}</strong><small>{firstProduct?.sku ? `SKU ${firstProduct.sku}` : ""}{order.products.length > 1 ? ` · +${order.products.length - 1} more` : ""}</small></td>
                      <td data-label="Order date">{formatDate(order.orderDate)}{risk === "approved" && order.confirmedAt ? <small>Confirmed {formatDate(order.confirmedAt)}</small> : order.deliveredAt && <small>Delivered {formatDate(order.deliveredAt)}</small>}</td>
                      <td data-label="Payment"><span className={`payment ${order.paymentMethod.toLowerCase()}`}>{order.paymentMethod || "—"}</span></td>
                      <td data-label="Amount"><strong>{formatCurrency(order.total)}</strong></td>
                      <td data-label="Status"><span className={`status ${statusClass(order.status)}`}><i />{order.status || "New"}</span></td>
                      <td data-label="AWB / Courier"><strong>{order.awb || "—"}</strong><small>{order.courier || "Not assigned"}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {loading && <div className="loading-state"><span className="loader" /><p>Loading live orders…</p></div>}
            {!loading && !error && data.orders.length === 0 && (
              <div className="empty-state"><div className="empty-glyph">↻</div><h2>No orders found</h2><p>{data.counts.all === 0 ? "Run the first Shiprocket sync to bring in your Shopify orders." : "Try changing the status, search, or filters."}</p>{data.counts.all === 0 && <button onClick={syncNow} disabled={syncing}>{syncing ? "Syncing…" : "Sync Shiprocket"}</button>}</div>
            )}
          </div>

          {!loading && data.total > 0 && (
            <footer className="pagination"><p>Showing {(page - 1) * data.perPage + 1}–{Math.min(page * data.perPage, data.total)} of {data.total} orders</p><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {data.totalPages}</span><button disabled={page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer>
          )}
        </section>

        <ConfirmationPanel active={view === "confirmation" || view === "campaigns"} section={view === "campaigns" ? "campaigns" : "confirmation"} preview={preview} />

        <InventoryPanel active={view === "inventory"} isAdmin={isAdmin || ["operations", "warehouse"].includes(userRole)} preview={preview} />
        <SupportPanel active={view === "support"} isAdmin={isAdmin} preview={preview} />

        <AnalyticsPanel mode="overview" active={view === "analytics"} preview={preview} />
        <AnalyticsPanel mode="today_ofd" active={view === "today_ofd"} preview={preview} />
        <ReportsPanel active={view === "reports"} preview={preview} />

        <section className={`logs-card ${view !== "logs" ? "view-hidden" : ""}`}>
          <header className="logs-heading">
            <div><p className="eyebrow">Live activity</p><h2>Sync & webhook logs</h2><p>Latest 200 changes received from Shiprocket and scheduled verification runs.</p></div>

          </header>
          <div className="log-health">
            <span><i className={logsData.sync.sync_status === "healthy" ? "healthy" : ""} />Sync {logsData.sync.sync_status || "waiting"}</span>
            <span>Last API check: {logsData.sync.last_sync_at ? formatDate(logsData.sync.last_sync_at) : "Not yet"}</span>
            <span>Orders checked: {logsData.sync.last_sync_count || "0"}</span>
          </div>
          <div className="logs-list">
            {logsData.logs.map((log) => (
              <article key={log.id} className={`log-row ${log.level}`}>
                <time>{formatDate(log.createdAt)}</time>
                <span className="log-source">{log.source}</span>
                <div><strong>{log.message}</strong><small>{log.eventType.replaceAll(".", " · ")}</small></div>
              </article>
            ))}
            {!logsLoading && logsData.logs.length === 0 && <div className="logs-empty">No activity recorded yet. New syncs and webhook updates will appear here.</div>}
            {logsLoading && logsData.logs.length === 0 && <div className="logs-empty">Loading activity…</div>}
          </div>
        </section>
      </section>
      </div>
    </main>
  );
}
