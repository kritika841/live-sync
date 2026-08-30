"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";

type TabKey = "new" | "ready" | "shipped" | "delivered" | "rto" | "all";
type Order = {
  id: number; channelOrderId: string; channelName: string; customerName: string;
  customerEmail: string; customerPhone: string; customerCity: string; customerState: string;
  orderDate: string; status: string; paymentMethod: string; paymentStatus: string;
  total: number; pickupLocation: string; awb: string; courier: string;
  products: Array<{ name?: string; sku?: string; quantity?: number }>; syncedAt: string;
};
type OrdersResponse = {
  orders: Order[];
  counts: Record<TabKey, number>;
  total: number; page: number; perPage: number; totalPages: number;
  sync: Record<string, string>;
  filterOptions: { couriers: string[]; pickups: string[] };
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "new", label: "New" }, { key: "ready", label: "Ready to ship" },
  { key: "shipped", label: "Shipped" }, { key: "delivered", label: "Delivered" },
  { key: "rto", label: "RTO" }, { key: "all", label: "All" },
];

const emptyData: OrdersResponse = {
  orders: [], counts: { new: 0, ready: 0, shipped: 0, delivered: 0, rto: 0, all: 0 },
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
const statusClass = (status: string) => {
  const s = status.toLowerCase();
  if (s.includes("rto") || s.includes("return")) return "rto";
  if (s.includes("delivered")) return "delivered";
  if (s.includes("ready") || s.includes("awb") || s.includes("manifest")) return "ready";
  if (s.includes("ship") || s.includes("transit") || s.includes("pickup")) return "shipped";
  return "new";
};

export default function OrdersDashboard({ userLabel }: { userLabel: string }) {
  const [tab, setTab] = useState<TabKey>("new");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [payment, setPayment] = useState("");
  const [courier, setCourier] = useState("");
  const [pickup, setPickup] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [data, setData] = useState<OrdersResponse>(emptyData);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ tab, page: String(page) });
    if (deferredSearch) params.set("search", deferredSearch);
    if (payment) params.set("payment", payment);
    if (courier) params.set("courier", courier);
    if (pickup) params.set("pickup", pickup);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [tab, page, deferredSearch, payment, courier, pickup, from, to]);

  const loading = loadedQuery !== query;

  async function loadOrders() {
    setError("");
    try {
      const response = await fetch(`/api/orders?${query}`, { cache: "no-store" });
      const payload = await response.json() as OrdersResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load orders");
      setData(payload);
      setLoadedQuery(query);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load orders");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/orders?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as OrdersResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load orders");
        return payload;
      })
      .then((payload) => {
        setData(payload);
        setLoadedQuery(query);
        setError("");
      })
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") setError(loadError.message || "Could not load orders");
      });
    return () => controller.abort();
  }, [query]);

  async function syncNow() {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "incremental" }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Sync failed");
      await loadOrders();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  function clearFilters() {
    setPayment(""); setCourier(""); setPickup(""); setFrom(""); setTo(""); setPage(1);
  }

  const appliedFilters = [payment, courier, pickup, from, to].filter(Boolean).length;
  const lastSync = data.sync.last_sync_at;
  const syncHealthy = data.sync.sync_status === "healthy";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><span>Satmi</span></div>
        <div className="channel-pill"><span className={`live-dot ${syncHealthy ? "online" : ""}`} /> Satmi · Shopify_5</div>
        <div className="user-label"><span className="lock-dot">◆</span>{userLabel}</div>
      </header>

      <section className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Order management</p>
            <h1>Orders</h1>
            <p className="subcopy">{lastSync ? `Last verified ${formatDate(lastSync)}` : "Waiting for the first Shiprocket sync"}</p>
          </div>
          <button className="sync-button" onClick={syncNow} disabled={syncing}>
            <span className={syncing ? "spin" : ""}>↻</span>{syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>

        {error && <div className="error-banner"><span>!</span><p>{error}</p><button onClick={() => loadOrders()}>Try again</button></div>}

        <section className="orders-card">
          <nav className="tabs" aria-label="Order status">
            {tabs.map((item) => (
              <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => { setTab(item.key); setPage(1); }}>
                {item.label}<span>{data.counts[item.key]}</span>
              </button>
            ))}
          </nav>

          <div className="toolbar">
            <label className="search"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} aria-label="Search orders" placeholder="Search order, customer, AWB or SKU" /></label>
            <button className={`filter-button ${filterOpen ? "active" : ""}`} onClick={() => setFilterOpen((value) => !value)}>
              Filters{appliedFilters > 0 && <b>{appliedFilters}</b>}<span>＋</span>
            </button>
          </div>

          {filterOpen && (
            <div className="filter-panel">
              <label>Payment<select value={payment} onChange={(event) => { setPayment(event.target.value); setPage(1); }}><option value="">All payments</option><option value="prepaid">Prepaid</option><option value="cod">COD</option></select></label>
              <label>Courier<select value={courier} onChange={(event) => { setCourier(event.target.value); setPage(1); }}><option value="">All couriers</option>{data.filterOptions.couriers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>Pickup location<select value={pickup} onChange={(event) => { setPickup(event.target.value); setPage(1); }}><option value="">All locations</option>{data.filterOptions.pickups.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>From<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
              <label>To<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
              <button className="clear-button" onClick={clearFilters} disabled={!appliedFilters}>Clear filters</button>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Customer</th><th>Products</th><th>Order date</th><th>Payment</th><th>Amount</th><th>Status</th><th>AWB / Courier</th></tr></thead>
              <tbody>
                {!loading && data.orders.map((order) => {
                  const firstProduct = order.products[0];
                  return (
                    <tr key={order.id}>
                      <td data-label="Order"><strong>#{order.channelOrderId || order.id}</strong><small>{order.channelName || "Shopify_5"}</small></td>
                      <td data-label="Customer"><strong>{order.customerName || "—"}</strong><small>{[order.customerCity, order.customerState].filter(Boolean).join(", ") || order.customerPhone || "—"}</small></td>
                      <td data-label="Products"><strong>{firstProduct?.name || "—"}</strong><small>{firstProduct?.sku ? `SKU ${firstProduct.sku}` : ""}{order.products.length > 1 ? ` · +${order.products.length - 1} more` : ""}</small></td>
                      <td data-label="Order date">{formatDate(order.orderDate)}</td>
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
      </section>
    </main>
  );
}
