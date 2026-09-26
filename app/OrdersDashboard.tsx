"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isTransientRequestError, readJson } from "../lib/http";
import Link from "next/link";
import {
  Check,
  ClipboardCheck,
  Copy,
  Menu,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  UsersRound,
  X,
} from "lucide-react";
import { statusTab } from "../lib/order-status";
import DateRangePicker from "./DateRangePicker";
import ConfirmationPanel from "./ConfirmationPanel";
import SettingsPanel from "./SettingsPanel";
import CopiedLogsPanel from "./CopiedLogsPanel";
import AccountMenu from "./AccountMenu";
import LiveStatus from "./LiveStatus";
import ThemeToggle from "../components/ThemeToggle";
import { Button } from "../components/ui/button";

type TabKey = "new" | "ready" | "shipped" | "out_for_delivery" | "undelivered" | "delivered" | "rto" | "all";
type RiskKey = "all" | "low" | "high" | "approved" | "low_approved";

type Order = {
  id: number;
  channelOrderId: string;
  channelName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerCity: string;
  customerState: string;
  orderDate: string;
  deliveredAt: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  total: number;
  pickupLocation: string;
  awb: string;
  courier: string;
  products: Array<{ name?: string; sku?: string; quantity?: number }>;
  syncedAt: string;
  confirmationNote?: string;
  confirmationStatus?: string;
  confirmationUpdatedAt?: string;
  confirmedAt?: string;
  rejectedAt?: string;
  copiedAt?: string;
  copiedBy?: string;
  copiedByName?: string;
  copiedCount?: number;
};

type OrdersResponse = {
  orders: Order[];
  counts: Record<TabKey, number>;
  riskCounts: Record<RiskKey, number>;
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  sync: Record<string, string>;
  filterOptions: { couriers: string[]; pickups: string[]; tags: string[] };
  unshippedOrdersWindowDays?: number;
};

type ActivityLog = {
  id: number;
  source: string;
  eventType: string;
  level: string;
  message: string;
  details: Record<string, unknown>;
  createdAt: string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
};

type LogsResponse = { logs: ActivityLog[]; sync: Record<string, string>; role?: string; userId?: string };

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "new", label: "New" },
  { key: "ready", label: "Ready to ship" },
  { key: "shipped", label: "Shipped" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "undelivered", label: "Undelivered" },
  { key: "delivered", label: "Delivered" },
  { key: "rto", label: "RTO" },
  { key: "all", label: "All" },
];

const emptyData: OrdersResponse = {
  orders: [],
  counts: { new: 0, ready: 0, shipped: 0, out_for_delivery: 0, undelivered: 0, delivered: 0, rto: 0, all: 0 },
  riskCounts: { all: 0, low: 0, high: 0, approved: 0, low_approved: 0 },
  total: 0,
  page: 1,
  perPage: 50,
  totalPages: 1,
  sync: {},
  filterOptions: { couriers: [], pickups: [], tags: [] },
};

function formatDate(value: string) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    value || 0
  );

const statusClass = (status: string) => statusTab(status);

function getStatusBadgeStyle(status: string) {
  const s = statusClass(status);
  if (s === "delivered") return "bg-success/15 text-success";
  if (s === "shipped") return "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400";
  if (s === "out_for_delivery") return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
  if (s === "ready") return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  if (s === "rto" || s === "undelivered") return "bg-destructive/15 text-destructive";
  if (s === "new") return "bg-primary/15 text-primary";
  return "bg-muted text-muted-foreground";
}

const indiaDateValue = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const todayValue = indiaDateValue(new Date());

export default function OrdersDashboard({
  userLabel,
  userEmail,
  userRole,
  isAdmin,
  preview = false,
}: {
  userLabel: string;
  userEmail: string;
  userRole: string;
  isAdmin: boolean;
  preview?: boolean;
}) {
  const [view, setView] = useState<"orders" | "confirmation" | "logs" | "settings" | "copied_logs">("orders");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("new");
  const [risk, setRisk] = useState<RiskKey>("all");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [deferredSearch, setDeferredSearch] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => setDeferredSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [payment, setPayment] = useState("");
  const [courier, setCourier] = useState("");
  const [tag, setTag] = useState("");
  const [pickup, setPickup] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [deliveredDate, setDeliveredDate] = useState("");
  const [copiedFilter, setCopiedFilter] = useState<"all" | "copied" | "uncopied">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [filterOpen, setFilterOpen] = useState(false);
  const [data, setData] = useState<OrdersResponse>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = sessionStorage.getItem("satmi_orders_cache");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed.orders) && parsed.orders.length > 0) return parsed;
        }
      } catch (err) {
        void err;
      }
    }
    return emptyData;
  });
  const [loadedQuery, setLoadedQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<Map<number, string>>(new Map());
  const [selectingAll, setSelectingAll] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [copiedIdFeedback, setCopiedIdFeedback] = useState<number | null>(null);
  const [logsData, setLogsData] = useState<LogsResponse>({ logs: [], sync: {} });
  const [logsLoading, setLogsLoading] = useState(true);

  const query = useMemo(() => {
    const params = new URLSearchParams({ tab, risk, page: String(page), sort });
    if (deferredSearch) params.set("search", deferredSearch);
    if (payment) params.set("payment", payment);
    if (courier) params.set("courier", courier);
    if (tag) params.set("tag", tag);
    if (pickup) params.set("pickup", pickup);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (copiedFilter !== "all") params.set("copied", copiedFilter);
    if (tab === "delivered" && deliveredDate) params.set("delivered_date", deliveredDate);
    return params.toString();
  }, [tab, risk, page, sort, deferredSearch, payment, courier, pickup, tag, from, to, copiedFilter, deliveredDate]);

  const currentQuery = useRef(query);
  useEffect(() => {
    currentQuery.current = query;
  }, [query]);

  const loading = !preview && !loadedQuery && !error && data.orders.length === 0;
  const changingQuery = !!loadedQuery && loadedQuery !== query;

  async function loadOrders(retryCount = 0) {
    if (preview) return;
    try {
      const response = await fetch(`/api/orders?${query}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      });
      const payload = (await readJson(response)) as OrdersResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load orders");
      if (currentQuery.current !== query) return;
      setData(payload);
      setLoadedQuery(query);
      setError("");
      if (typeof window !== "undefined" && payload.orders && payload.orders.length > 0) {
        try {
          sessionStorage.setItem("satmi_orders_cache", JSON.stringify(payload));
        } catch (err) {
          void err;
        }
      }
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === "AbortError") return;
      if (isTransientRequestError(loadError)) {
        if (retryCount < 3) {
          window.setTimeout(() => void loadOrders(retryCount + 1), 1500 * (retryCount + 1));
        }
        return;
      }
      const msg = loadError instanceof Error ? loadError.message : "Could not load orders";
      if (!/signal timed out|timeout|timed out|abort/i.test(msg)) {
        setError(msg);
      }
    }
  }

  useEffect(() => {
    if (preview || view !== "orders") return;
    const controller = new AbortController();
    let retryTimer: number | null = null;

    function fetchWithRetry(retriesLeft = 2) {
      fetch(`/api/orders?${query}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        cache: "no-store",
      })
        .then(async (response) => {
          const payload = (await readJson(response)) as OrdersResponse & { error?: string };
          if (!response.ok) throw new Error(payload.error || "Could not load orders");
          return payload;
        })
        .then((payload) => {
          if (controller.signal.aborted) return;
          setData(payload);
          setLoadedQuery(query);
          setSelectedOrders(new Map());
          setCopyState("idle");
          setError("");
          if (typeof window !== "undefined" && payload.orders && payload.orders.length > 0) {
            try {
              sessionStorage.setItem("satmi_orders_cache", JSON.stringify(payload));
            } catch (err) {
              void err;
            }
          }
        })
        .catch((loadError: Error) => {
          if (controller.signal.aborted || loadError.name === "AbortError") return;
          if (isTransientRequestError(loadError)) {
            if (retriesLeft > 0) {
              retryTimer = window.setTimeout(() => fetchWithRetry(retriesLeft - 1), 1500);
            }
            return;
          }
          const msg = loadError.message || "Could not load orders";
          if (!/signal timed out|timeout|timed out|abort/i.test(msg)) {
            setError(msg);
          }
        });
    }

    fetchWithRetry();

    return () => {
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [query, preview, view]);

  useEffect(() => {
    if (preview || view !== "logs") return;
    const controller = new AbortController();
    fetch("/api/logs", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
      cache: "no-store",
    })
      .then((response) => readJson<LogsResponse>(response))
      .then((payload: LogsResponse) => setLogsData(payload))
      .catch((logsError: Error) => {
        if (logsError.name !== "AbortError" && !isTransientRequestError(logsError)) setError(logsError.message);
      })
      .finally(() => setLogsLoading(false));
    return () => controller.abort();
  }, [preview, view]);

  useEffect(() => {
    if (preview || view !== "logs") return;
    const interval = window.setInterval(() => {
      fetch("/api/logs", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: LogsResponse | null) => {
          if (payload) setLogsData(payload);
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(interval);
  }, [view, preview]);

  useEffect(() => {
    if (preview || view !== "orders") return;
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (running || document.hidden || syncing || loading) return;
      running = true;
      try {
        const response = await fetch(`/api/orders?${query}`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        });
        const payload = await readJson<OrdersResponse>(response);
        if (!controller.signal.aborted && currentQuery.current === query) {
          setData(payload);
          setLoadedQuery(query);
        }
      } catch {
        /* Ignore periodic background poll failures */
      } finally {
        running = false;
      }
    };
    const interval = window.setInterval(() => void refresh(), 25000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [query, view, preview, syncing, loading]);

  async function loadLogs() {
    if (preview) return;
    setLogsLoading(true);
    try {
      const response = await fetch("/api/logs", { cache: "no-store", signal: AbortSignal.timeout(45000) });
      const payload = (await readJson(response)) as LogsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load activity logs");
      setLogsData(payload);
    } catch (logsError) {
      if (!isTransientRequestError(logsError)) {
        const msg = logsError instanceof Error ? logsError.message : "Could not load activity logs";
        if (!/signal timed out|timeout|timed out|abort/i.test(msg)) {
          setError(msg);
        }
      }
    } finally {
      setLogsLoading(false);
    }
  }

  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (preview || autoSyncedRef.current || !loadedQuery) return;
    autoSyncedRef.current = true;
    (async () => {
      try {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json", "x-requested-with": "satmi-orders-dashboard" },
          body: JSON.stringify({ mode: "incremental" }),
          signal: AbortSignal.timeout(60000),
        });
        if (response.ok) {
          await loadOrders();
        }
      } catch {
        /* Ignore background auto-sync failure */
      }
    })();
  }, [preview, loadedQuery]);

  async function syncNow() {
    if (preview) return;
    setSyncing(true);
    setError("");
    try {
      let syncPage: number | undefined;
      let mode: "incremental" | "full" = "incremental";
      do {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json", "x-requested-with": "satmi-orders-dashboard" },
          body: JSON.stringify({ mode, page: syncPage }),
          signal: AbortSignal.timeout(90000),
        });
        const payload = (await readJson(response)) as {
          error?: string;
          mode?: "incremental" | "full";
          hasMore?: boolean;
          nextPage?: number;
          message?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Sync failed");
        if (payload.message === "Sync already in progress") {
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
          await loadOrders();
          return;
        }
        if (payload.mode === "full") mode = "full";
        syncPage = payload.hasMore ? payload.nextPage : undefined;
        await loadOrders();
      } while (syncPage);
      await loadOrders();
    } catch (syncError) {
      if (!isTransientRequestError(syncError)) {
        const msg = syncError instanceof Error ? syncError.message : "Sync failed";
        if (!/signal timed out|timeout|timed out|abort/i.test(msg)) {
          setError(msg);
        }
      }
    } finally {
      setSyncing(false);
    }
  }

  function clearFilters() {
    setPayment("");
    setCourier("");
    setPickup("");
    setTag("");
    setFrom("");
    setTo("");
    setDeliveredDate("");
    setCopiedFilter("all");
    setPage(1);
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
      const response = await fetch(`/api/orders?${params.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(45000),
      });
      const payload = (await readJson(response)) as {
        orders?: Array<{ id: number; channelOrderId: string }>;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Could not select all orders");
      setSelectedOrders(
        new Map((payload.orders || []).map((order) => [order.id, String(order.channelOrderId || order.id)]))
      );
      setCopyState("idle");
    } catch (selectionError) {
      if (!isTransientRequestError(selectionError)) {
        const msg = selectionError instanceof Error ? selectionError.message : "Could not select all orders";
        if (!/signal timed out|timeout|timed out|abort/i.test(msg)) {
          setError(msg);
        }
      }
    } finally {
      setSelectingAll(false);
    }
  }

  async function copySelectedOrderIds() {
    const rawIds = Array.from(selectedOrders.values())
      .map((orderId) => orderId.replace(/^#+/, "").replace(/\s+/g, ""));
    const value = rawIds.join(",");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);

      // Log copy batch to backend and update local orders state
      if (!preview) {
        const selectedIds = Array.from(selectedOrders.keys());
        void fetch("/api/orders/copied", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderIds: selectedIds,
            channelOrderIds: rawIds,
            tab,
          }),
        }).then(() => {
          const now = new Date().toISOString();
          setData((prev) => ({
            ...prev,
            orders: prev.orders.map((o) =>
              selectedOrders.has(o.id)
                ? { ...o, copiedAt: now, copiedByName: userLabel, copiedCount: (o.copiedCount || 0) + 1 }
                : o
            ),
          }));
        });
      }
    } catch {
      setError("Could not copy order IDs. Please allow clipboard access and try again.");
    }
  }

  async function copySingleOrderId(order: Order) {
    const rawId = (order.channelOrderId || String(order.id)).replace(/^#+/, "").trim();
    if (!rawId) return;
    try {
      await navigator.clipboard.writeText(rawId);
      setCopiedIdFeedback(order.id);
      window.setTimeout(() => setCopiedIdFeedback(null), 1800);

      if (!preview) {
        void fetch("/api/orders/copied", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderIds: [order.id],
            channelOrderIds: [rawId],
            tab,
          }),
        }).then(() => {
          const now = new Date().toISOString();
          setData((prev) => ({
            ...prev,
            orders: prev.orders.map((o) =>
              o.id === order.id
                ? { ...o, copiedAt: now, copiedByName: userLabel, copiedCount: (o.copiedCount || 0) + 1 }
                : o
            ),
          }));
        });
      }
    } catch {
      setError("Could not copy order ID. Please allow clipboard access and try again.");
    }
  }

  const appliedFilters = [
    payment,
    courier,
    pickup,
    tag,
    from,
    to,
    tab === "delivered" ? deliveredDate : "",
    copiedFilter !== "all" ? copiedFilter : "",
  ].filter(Boolean).length;
  const visibleIds = data.orders.map((order) => order.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedOrders.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedOrders.has(id));
  const allResultsSelected = data.total > 0 && selectedOrders.size === data.total;

  const initials =
    userLabel
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U";

  const viewCopy = {
    orders: { eyebrow: "Order management", title: "Orders" },
    confirmation: { eyebrow: "Customer verification", title: "Confirmation" },
    logs: { eyebrow: "Live activity", title: "Activity log" },
    copied_logs: { eyebrow: "Copy tracking", title: "Copied logs" },
    settings: { eyebrow: "System preferences", title: "Settings" },
  }[view];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* 1. LEFT FIXED SIDEBAR (w-[248px]) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-border bg-card lg:flex lg:flex-col">
        {/* Top Header: Brand Logo with Product Name beneath (stacked layout, no subtitle) */}
        <div className="flex min-h-[84px] items-center border-b border-border px-5 py-3.5">
          <Link href="/" className="flex flex-col items-start gap-1">
            <div className="relative flex items-center">
              {/* Light mode */}
              <img
                src="/logo-light.png"
                alt="Satmi"
                className="h-7 w-auto max-w-[120px] object-contain dark:hidden"
              />
              {/* Dark mode */}
              <img
                src="/logo-dark.png"
                alt="Satmi"
                className="hidden h-7 w-auto max-w-[120px] object-contain dark:block"
              />
            </div>
            <span className="text-[13px] font-semibold tracking-tight text-foreground">
              Satmi Ops
            </span>
          </Link>
        </div>

        {/* Sidebar Body: Navigation Links */}
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <div className="space-y-6">
            <div>
              <p className="px-3 text-[11px] font-semibold uppercase text-muted-foreground mb-2">
                Workspace
              </p>
              <nav className="space-y-1">
                <button
                  title="Orders"
                  className={`group relative flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium transition-colors duration-150 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity ${
                    view === "orders"
                      ? "bg-accent/80 text-accent-foreground font-semibold before:opacity-100"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => setView("orders")}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ShoppingBag size={18} className={view === "orders" ? "text-primary" : "text-muted-foreground"} />
                    <span className="truncate">Orders</span>
                  </div>
                </button>
                <button
                  title="Confirmation"
                  className={`group relative flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium transition-colors duration-150 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity ${
                    view === "confirmation"
                      ? "bg-accent/80 text-accent-foreground font-semibold before:opacity-100"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => setView("confirmation")}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <PhoneCall size={18} className={view === "confirmation" ? "text-primary" : "text-muted-foreground"} />
                    <span className="truncate">Confirmation</span>
                  </div>
                </button>
                <button
                  title="Activity log"
                  className={`group relative flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium transition-colors duration-150 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity ${
                    view === "logs"
                      ? "bg-accent/80 text-accent-foreground font-semibold before:opacity-100"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => {
                    setView("logs");
                    void loadLogs();
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <RotateCcw size={18} className={view === "logs" ? "text-primary" : "text-muted-foreground"} />
                    <span className="truncate">Activity log</span>
                  </div>
                </button>
              </nav>
            </div>

            {isAdmin && (
              <div>
                <p className="px-3 text-[11px] font-semibold uppercase text-muted-foreground mb-2">
                  Admin
                </p>
                <nav className="space-y-1">
                  <button
                    title="Copied logs"
                    className={`group relative flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium transition-colors duration-150 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity ${
                      view === "copied_logs"
                        ? "bg-accent/80 text-accent-foreground font-semibold before:opacity-100"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    onClick={() => setView("copied_logs")}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <ClipboardCheck size={18} className={view === "copied_logs" ? "text-primary" : "text-muted-foreground"} />
                      <span className="truncate">Copied logs</span>
                    </div>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary border border-primary/20">Admin</span>
                  </button>
                  <button
                    title="Settings"
                    className={`group relative flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium transition-colors duration-150 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity ${
                      view === "settings"
                        ? "bg-accent/80 text-accent-foreground font-semibold before:opacity-100"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    onClick={() => setView("settings")}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Settings size={18} className={view === "settings" ? "text-primary" : "text-muted-foreground"} />
                      <span className="truncate">Settings</span>
                    </div>
                  </button>
                  <Link
                    href="/admin/users"
                    title="Manage users"
                    className="group relative flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <UsersRound size={18} className="text-muted-foreground" />
                      <span className="truncate">Manage users</span>
                    </div>
                  </Link>
                </nav>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Footer: User Avatar Pill */}
        <div className="border-t border-border p-3">
          <div className="flex items-center justify-between gap-2.5 rounded-lg bg-muted/40 p-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold">
                {initials}
              </div>
              <div className="min-w-0">
                <span className="block truncate text-xs font-semibold text-foreground">{userLabel}</span>
                <span className="block truncate text-[10px] text-muted-foreground capitalize">
                  {userRole.replaceAll("_", " ")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* MOBILE DRAWER OVERLAY */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 bg-black/60 backdrop-blur-xs w-full h-full border-0 cursor-default"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative flex w-72 max-w-[85vw] flex-col border-r border-border bg-card p-4 shadow-float">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div className="flex flex-col items-start gap-1">
                <div className="relative flex items-center">
                  <img src="/logo-light.png" alt="Satmi" className="h-7 w-auto max-w-[120px] object-contain dark:hidden" />
                  <img src="/logo-dark.png" alt="Satmi" className="hidden h-7 w-auto max-w-[120px] object-contain dark:block" />
                </div>
                <span className="text-[13px] font-semibold tracking-tight text-foreground">
                  Satmi Ops
                </span>
              </div>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              <nav className="space-y-1">
                <button
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    view === "orders" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => {
                    setView("orders");
                    setMobileNavOpen(false);
                  }}
                >
                  <ShoppingBag size={17} />
                  <span>Orders</span>
                </button>
                <button
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    view === "confirmation" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => {
                    setView("confirmation");
                    setMobileNavOpen(false);
                  }}
                >
                  <PhoneCall size={17} />
                  <span>Confirmation</span>
                </button>
                <button
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    view === "logs" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => {
                    setView("logs");
                    setMobileNavOpen(false);
                    void loadLogs();
                  }}
                >
                  <RotateCcw size={17} />
                  <span>Activity log</span>
                </button>
                {isAdmin && (
                  <>
                    <button
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
                        view === "copied_logs" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                      }`}
                      onClick={() => {
                        setView("copied_logs");
                        setMobileNavOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <ClipboardCheck size={17} className={view === "copied_logs" ? "text-primary" : "text-muted-foreground"} />
                        <span>Copied logs</span>
                      </div>
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary border border-primary/20">Admin</span>
                    </button>
                    <button
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        view === "settings" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-muted"
                      }`}
                      onClick={() => {
                        setView("settings");
                        setMobileNavOpen(false);
                      }}
                    >
                      <Settings size={17} />
                      <span>Settings</span>
                    </button>
                    <Link
                      href="/admin/users"
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                    >
                      <UsersRound size={17} />
                      <span>Manage users</span>
                    </Link>
                  </>
                )}
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* 2. STICKY TOP BAR (h-16) */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/90 bg-card/95 px-4 backdrop-blur lg:pl-[268px] lg:pr-7">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-muted lg:hidden"
            aria-label="Open mobile navigation"
          >
            <Menu size={18} />
          </button>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">{viewCopy.eyebrow}</p>
            <h1 className="text-base font-semibold text-foreground leading-tight">{viewCopy.title}</h1>
          </div>
          <span className="hidden sm:inline-flex items-center rounded-full bg-accent/70 px-2.5 py-0.5 text-[10px] font-semibold text-accent-foreground ml-2">
            {userRole === "admin" ? "Administrator" : "Operations"}
          </span>
        </div>

        {/* Right utility cluster: Search + LiveStatus + ThemeToggle + AccountMenu */}
        <div className="flex items-center gap-2.5">
          <div className="relative hidden md:flex items-center w-56 lg:w-72">
            <Search size={14} className="absolute left-3 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setView("orders");
                setPage(1);
              }}
              placeholder="Search orders, customer, AWB..."
              className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </div>
          <LiveStatus preview={preview} />
          <ThemeToggle />
          <AccountMenu preview={preview} name={userLabel} email={userEmail} isAdmin={isAdmin} />
        </div>
      </header>

      {/* 3. MAIN CONTENT CONTAINER (Wrapper offset lg:pl-[248px]) */}
      <main className="flex-1 lg:pl-[248px]">
        <div className="page-container">
          {view === "orders" && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold tracking-tight text-foreground">Order Management</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Live synced order fulfillment and risk tracking</p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={syncNow}
                disabled={syncing || preview}
              >
                <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                <span>{syncing ? "Syncing Shiprocket…" : "Sync now"}</span>
              </Button>
            </div>
          )}

          {error && !/signal timed out|timeout|timed out|abort/i.test(error) && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
              <div className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground font-bold text-[10px]">
                  !
                </span>
                <p className="font-medium">{error}</p>
              </div>
              <button onClick={() => loadOrders()} className="font-semibold underline hover:opacity-80">
                Try again
              </button>
            </div>
          )}

          {/* ORDERS VIEW PANEL */}
          <section className={`panel overflow-hidden ${view !== "orders" ? "view-hidden" : ""}`}>
            {/* Status Tabs */}
            <nav
              className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/40 p-1.5 scrollbar-none"
              aria-label="Order status"
            >
              {tabs.map((item) => {
                const isActive = tab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setTab(item.key);
                      if (["approved", "low_approved"].includes(risk)) setRisk("all");
                      setPage(1);
                    }}
                    className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all ${
                      isActive
                        ? "bg-card text-foreground shadow-xs border border-border/80"
                        : "text-muted-foreground hover:bg-card/50 hover:text-foreground"
                    }`}
                  >
                    <span>{item.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {data.counts[item.key]}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Risk Sub-tabs */}
            <nav className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 bg-card" aria-label="RTO risk">
              <span className="text-xs font-medium text-muted-foreground mr-1">Risk filter:</span>
              <button
                onClick={() => {
                  setRisk("all");
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                  risk === "all"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                All <span className="opacity-70 text-[10px]">({data.riskCounts.all})</span>
              </button>
              <button
                onClick={() => {
                  setRisk("low");
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                  risk === "low"
                    ? "bg-success/20 text-success border border-success/40"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="size-1.5 rounded-full bg-success" />
                Low risk <span className="opacity-70 text-[10px]">({data.riskCounts.low})</span>
              </button>
              <button
                onClick={() => {
                  setRisk("high");
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                  risk === "high"
                    ? "bg-destructive/20 text-destructive border border-destructive/40"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="size-1.5 rounded-full bg-destructive" />
                High risk <span className="opacity-70 text-[10px]">({data.riskCounts.high})</span>
              </button>
              {tab === "new" && (
                <button
                  onClick={() => {
                    setRisk("approved");
                    setFilterOpen(false);
                    setPage(1);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                    risk === "approved"
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="size-1.5 rounded-full bg-primary" />
                  Approved <span className="opacity-70 text-[10px]">({data.riskCounts.approved})</span>
                </button>
              )}
              {tab === "new" && (
                <button
                  onClick={() => {
                    setRisk("low_approved");
                    setPage(1);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                    risk === "low_approved"
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Low risk + approved <span className="opacity-70 text-[10px]">({data.riskCounts.low_approved})</span>
                </button>
              )}
            </nav>

            {/* Delivered Date Filter */}
            {risk !== "approved" && tab === "delivered" && (
              <div className="flex items-center gap-3 border-b border-border bg-muted/20 px-5 py-2.5">
                <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <span className="text-muted-foreground">Delivered date:</span>
                  <input
                    type="date"
                    value={deliveredDate}
                    max={todayValue}
                    onChange={(event) => {
                      setDeliveredDate(event.target.value);
                      setPage(1);
                    }}
                    className="h-8 rounded-lg border border-input bg-card px-2.5 text-xs text-foreground outline-none"
                  />
                </label>
                {deliveredDate && (
                  <button
                    onClick={() => {
                      setDeliveredDate("");
                      setPage(1);
                    }}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground underline"
                  >
                    Clear date
                  </button>
                )}
              </div>
            )}

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 bg-card">
              <div className="flex md:hidden items-center flex-1 max-w-xs">
                <div className="relative w-full">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Search orders..."
                    className="h-8 w-full rounded-lg border border-input bg-card pl-8 pr-3 text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 ml-auto">
                {/* ID Copy Quick Filter */}
                <div className="flex items-center gap-1 bg-muted/70 p-1 rounded-lg border border-border">
                  <span className="text-[10px] font-bold text-muted-foreground px-1 uppercase tracking-wider">
                    ID:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCopiedFilter("all");
                      setPage(1);
                    }}
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold transition ${
                      copiedFilter === "all"
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCopiedFilter("copied");
                      setPage(1);
                    }}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold transition ${
                      copiedFilter === "copied"
                        ? "bg-card text-emerald-700 dark:text-emerald-400 shadow-2xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="Show orders with copied IDs"
                  >
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Copied
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCopiedFilter("uncopied");
                      setPage(1);
                    }}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold transition ${
                      copiedFilter === "uncopied"
                        ? "bg-card text-amber-700 dark:text-amber-400 shadow-2xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="Show orders whose IDs have not been copied"
                  >
                    <span className="size-1.5 rounded-full bg-amber-500" />
                    Not copied
                  </button>
                </div>

                <div className="flex items-center gap-2 rounded-lg border border-input bg-card px-2.5 py-1 text-xs">
                  <span className="font-medium text-muted-foreground">Sort:</span>
                  <select
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value as "newest" | "oldest");
                      setPage(1);
                    }}
                    className="bg-transparent font-medium text-foreground outline-none cursor-pointer"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </select>
                </div>

                <button
                  onClick={() => setFilterOpen((v) => !v)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    filterOpen || appliedFilters > 0
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground hover:bg-muted"
                  }`}
                >
                  <SlidersHorizontal size={13} />
                  <span>Filters</span>
                  {appliedFilters > 0 && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold">
                      {appliedFilters}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Filter Panel */}
            {filterOpen && (
              <div className="border-b border-border bg-muted/20 p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3.5 items-end">
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>Payment</span>
                    <select
                      value={payment}
                      onChange={(event) => {
                        setPayment(event.target.value);
                        setPage(1);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2.5 text-xs text-foreground outline-none"
                    >
                      <option value="">All payments</option>
                      <option value="prepaid">Prepaid</option>
                      <option value="cod">COD</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>Courier</span>
                    <select
                      value={courier}
                      onChange={(event) => {
                        setCourier(event.target.value);
                        setPage(1);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2.5 text-xs text-foreground outline-none"
                    >
                      <option value="">All couriers</option>
                      {data.filterOptions.couriers.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>Pickup location</span>
                    <select
                      value={pickup}
                      onChange={(event) => {
                        setPickup(event.target.value);
                        setPage(1);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2.5 text-xs text-foreground outline-none"
                    >
                      <option value="">All locations</option>
                      {data.filterOptions.pickups.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>Shopify tag</span>
                    <select
                      value={tag}
                      onChange={(e) => {
                        setTag(e.target.value);
                        setPage(1);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2.5 text-xs text-foreground outline-none"
                    >
                      <option value="">All tags</option>
                      {data.filterOptions.tags?.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>ID Copy status</span>
                    <select
                      value={copiedFilter}
                      onChange={(e) => {
                        setCopiedFilter(e.target.value as "all" | "copied" | "uncopied");
                        setPage(1);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2.5 text-xs text-foreground outline-none"
                    >
                      <option value="all">All orders</option>
                      <option value="copied">Copied IDs</option>
                      <option value="uncopied">Not copied</option>
                    </select>
                  </label>

                  <div className="col-span-2 md:col-span-2 lg:col-span-1">
                    <DateRangePicker
                      from={from}
                      to={to}
                      max={todayValue}
                      onApply={(start, end) => {
                        setFrom(start);
                        setTo(end);
                        setPage(1);
                      }}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={clearFilters}
                      disabled={!appliedFilters}
                      className="w-full text-xs"
                    >
                      Clear filters
                    </Button>
                  </div>
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mr-1">
                    Quick date:
                  </span>
                  <button
                    onClick={() => applyRecentDays(1)}
                    className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Today
                  </button>
                  <button
                    onClick={applyYesterday}
                    className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Yesterday
                  </button>
                  <button
                    onClick={() => applyRecentDays(7)}
                    className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Last 7 days
                  </button>
                  <button
                    onClick={() => applyRecentDays(30)}
                    className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Last 30 days
                  </button>
                </div>
              </div>
            )}

            {/* Selection Controls */}
            <div className="flex items-center gap-5 border-b border-border bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
              <label className="flex items-center gap-2 cursor-pointer font-medium hover:text-foreground">
                <input
                  type="checkbox"
                  checked={allResultsSelected}
                  ref={(element) => {
                    if (element) element.indeterminate = selectedOrders.size > 0 && !allResultsSelected;
                  }}
                  onChange={toggleAllResults}
                  disabled={selectingAll || loading || changingQuery || data.total === 0}
                  className="size-4 rounded border-input accent-primary cursor-pointer"
                />
                <span>{selectingAll ? "Selecting…" : `All pages (${data.total})`}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer font-medium hover:text-foreground">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(element) => {
                    if (element) element.indeterminate = someVisibleSelected && !allVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                  disabled={loading || changingQuery || data.orders.length === 0}
                  className="size-4 rounded border-input accent-primary cursor-pointer"
                />
                <span>This page ({data.orders.length})</span>
              </label>
            </div>

            {/* Selection Bar */}
            {selectedOrders.size > 0 && (
              <div className="flex items-center justify-between border-b border-primary/20 bg-accent/40 px-5 py-2.5 text-xs font-semibold text-accent-foreground">
                <span>{selectedOrders.size} orders selected</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={copySelectedOrderIds}
                    className="rounded-md border border-primary/40 bg-card px-3 py-1 text-xs font-semibold text-foreground hover:bg-muted shadow-xs"
                  >
                    {copyState === "copied" ? "Copied!" : "Copy order IDs"}
                  </button>
                  <button
                    onClick={() => setSelectedOrders(new Map())}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Table Wrap */}
            <div className="overflow-x-auto min-h-[360px] relative" aria-busy={changingQuery}>
              <table className="w-full text-left text-sm border-collapse min-w-[1000px]">
                <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Order</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Products</th>
                    <th className="px-4 py-3">Order date</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">AWB / Courier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {!loading &&
                    data.orders.map((order) => {
                      const firstProduct = order.products[0];
                      const isSelected = selectedOrders.has(order.id);
                      return (
                        <tr
                          key={order.id}
                          className={`transition-colors ${
                            isSelected ? "bg-accent/30 hover:bg-accent/40" : "bg-card hover:bg-muted/40"
                          }`}
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleOrder(order)}
                                aria-label={`Select order ${order.channelOrderId || order.id}`}
                                className="size-4 rounded border-input accent-primary cursor-pointer shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <strong className="block font-mono text-xs font-bold text-foreground">
                                    #{order.channelOrderId || order.id}
                                  </strong>
                                  <button
                                    type="button"
                                    onClick={() => void copySingleOrderId(order)}
                                    title="Copy order ID"
                                    className="text-muted-foreground hover:text-foreground p-0.5 rounded transition"
                                  >
                                    {copiedIdFeedback === order.id ? (
                                      <Check size={12} className="text-emerald-500" />
                                    ) : (
                                      <Copy size={12} />
                                    )}
                                  </button>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="block text-[11px] text-muted-foreground truncate">
                                    {order.channelName || "Shopify_5"}
                                  </span>
                                  {order.copiedAt ? (
                                    <span
                                      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0"
                                      title={`ID copied ${formatDate(order.copiedAt)}${order.copiedByName ? ` by ${order.copiedByName}` : ""}`}
                                    >
                                      ✓ Copied{order.copiedCount && order.copiedCount > 1 ? ` (${order.copiedCount}x)` : ""}
                                    </span>
                                  ) : (
                                    <span
                                      className="inline-flex items-center rounded px-1.5 py-0.2 text-[9px] font-medium bg-muted text-muted-foreground border border-border shrink-0"
                                      title="ID not copied yet"
                                    >
                                      Not copied
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <strong className="block text-sm font-semibold text-foreground">
                              {order.customerName || "—"}
                            </strong>
                            <small className="block text-xs text-muted-foreground">
                              {[order.customerCity, order.customerState].filter(Boolean).join(", ") ||
                                order.customerPhone ||
                                "—"}
                            </small>
                          </td>

                          <td className="px-4 py-3.5">
                            <strong className="block text-sm font-medium text-foreground truncate max-w-xs">
                              {firstProduct?.name || "—"}
                            </strong>
                            <small className="block text-xs text-muted-foreground">
                              {firstProduct?.sku ? `SKU ${firstProduct.sku}` : ""}
                              {order.products.length > 1 ? ` · +${order.products.length - 1} more` : ""}
                            </small>
                          </td>

                          <td className="px-4 py-3.5 tabular-nums text-xs text-foreground">
                            <div>{formatDate(order.orderDate)}</div>
                            {risk === "approved" && order.confirmedAt ? (
                              <small className="block text-[11px] text-muted-foreground">
                                Confirmed {formatDate(order.confirmedAt)}
                              </small>
                            ) : (
                              order.deliveredAt && (
                                <small className="block text-[11px] text-muted-foreground">
                                  Delivered {formatDate(order.deliveredAt)}
                                </small>
                              )
                            )}
                          </td>

                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${
                                order.paymentMethod.toLowerCase() === "prepaid"
                                  ? "bg-accent text-accent-foreground"
                                  : "bg-warning/15 text-warning"
                              }`}
                            >
                              {order.paymentMethod || "—"}
                            </span>
                          </td>

                          <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-foreground">
                            {formatCurrency(order.total)}
                          </td>

                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeStyle(
                                order.status
                              )}`}
                            >
                              <span>{order.status || "New"}</span>
                            </span>
                            {order.confirmationStatus === "confirmed" && (
                              <small className="block text-[11px] text-muted-foreground mt-1">
                                Conf: {order.confirmationNote || "Saved"}
                              </small>
                            )}
                          </td>

                          <td className="px-4 py-3.5">
                            <strong className="block font-mono text-xs font-semibold text-foreground">
                              {order.awb || "—"}
                            </strong>
                            <small className="block text-xs text-muted-foreground">
                              {order.courier || "Not assigned"}
                            </small>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>

              {loading && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="size-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                  <p className="mt-3 text-xs text-muted-foreground font-medium">Loading live orders…</p>
                </div>
              )}

              {!loading && !error && data.orders.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground mb-3 text-lg font-bold">
                    ∅
                  </div>
                  <h3 className="text-base font-semibold text-foreground">No orders found</h3>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    {data.counts.all === 0
                      ? "Run the first Shiprocket sync to bring in your Shopify orders."
                      : "Try changing the status, search, or filters."}
                  </p>
                  {data.counts.all === 0 && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={syncNow}
                      disabled={syncing}
                      className="mt-4"
                    >
                      {syncing ? "Syncing…" : "Sync Shiprocket"}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Pagination */}
            {!loading && data.total > 0 && (
              <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground bg-card">
                <p>
                  Showing <strong className="text-foreground">{(page - 1) * data.perPage + 1}</strong>–
                  <strong className="text-foreground">{Math.min(page * data.perPage, data.total)}</strong> of{" "}
                  <strong className="text-foreground">{data.total}</strong> orders
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                    className="h-8 px-2.5 text-xs"
                  >
                    Previous
                  </Button>
                  <span className="font-medium text-foreground">
                    Page {page} of {data.totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => setPage((value) => value + 1)}
                    className="h-8 px-2.5 text-xs"
                  >
                    Next
                  </Button>
                </div>
              </footer>
            )}
          </section>

          {/* CONFIRMATION PANEL */}
          <ConfirmationPanel active={view === "confirmation"} preview={preview} isAdmin={isAdmin} />

          {/* SETTINGS PANEL */}
          <SettingsPanel
            active={view === "settings"}
            isAdmin={isAdmin}
            initialDays={data.unshippedOrdersWindowDays || 30}
            onSaved={() => void loadOrders()}
          />

          {/* ACTIVITY LOGS PANEL */}
          <section className={`panel overflow-hidden ${view !== "logs" ? "view-hidden" : ""}`}>
            <header className="border-b border-border p-5 bg-card flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Live activity</p>
                <h2 className="text-base font-bold text-foreground">Sync & Webhook Logs</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Latest 200 changes received from Shiprocket and scheduled verification runs.
                </p>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setView("logs")}
                    className="px-3 py-1 text-xs font-semibold rounded-md bg-card text-foreground shadow-xs"
                  >
                    Activity log
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("copied_logs")}
                    className="px-3 py-1 text-xs font-semibold rounded-md text-muted-foreground hover:text-foreground transition flex items-center gap-1.5"
                  >
                    <ClipboardCheck size={13} className="text-primary" />
                    <span>Copied logs</span>
                    <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[9px] font-bold text-primary">Admin</span>
                  </button>
                </div>
              )}
            </header>

            <div className="flex flex-wrap items-center gap-6 border-b border-border bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-2 font-medium">
                <span
                  className={`size-2 rounded-full ${
                    logsData.sync.sync_status === "healthy" ? "bg-success" : "bg-warning"
                  }`}
                />
                Sync {logsData.sync.sync_status || "waiting"}
              </span>
              <span>
                Last API check:{" "}
                <strong className="text-foreground">
                  {logsData.sync.last_sync_at ? formatDate(logsData.sync.last_sync_at) : "Not yet"}
                </strong>
              </span>
              <span>
                Orders checked:{" "}
                <strong className="text-foreground">{logsData.sync.last_sync_count || "0"}</strong>
              </span>
            </div>

            <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
              {logsData.logs.map((log) => (
                <article key={log.id} className="flex flex-wrap items-center gap-4 px-5 py-3 hover:bg-muted/30 transition">
                  <time className="text-xs font-mono text-muted-foreground w-36 shrink-0">
                    {formatDate(log.createdAt)}
                  </time>
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold text-accent-foreground uppercase tracking-wide">
                    {log.source}
                  </span>
                  <div className="flex-1 min-w-0">
                    {log.actorRole && (
                      <span className={`log-actor-badge ${log.actorRole}`}>
                        {log.actorRole === "system"
                          ? "System"
                          : `${log.actorRole.replaceAll("_", " ")}: ${log.actorName || log.actorId}`}
                      </span>
                    )}
                    <strong className="block text-xs font-semibold text-foreground">{log.message}</strong>
                    <small className="block text-[10px] text-muted-foreground font-mono mt-0.5">
                      {log.eventType.replaceAll(".", " · ")}
                    </small>
                  </div>
                </article>
              ))}

              {!logsLoading && logsData.logs.length === 0 && (
                <div className="py-16 text-center text-xs text-muted-foreground">
                  {isAdmin || userRole === "support_manager"
                    ? "No activity recorded yet. New syncs and webhook updates will appear here."
                    : "No activity recorded for your account yet. Actions you take on orders will appear here."}
                </div>
              )}
              {logsLoading && logsData.logs.length === 0 && (
                <div className="py-16 text-center text-xs text-muted-foreground">Loading activity…</div>
              )}
            </div>
          </section>

          {/* COPIED LOGS PANEL (ADMIN ONLY) */}
          {isAdmin && (
            <CopiedLogsPanel
              active={view === "copied_logs"}
              preview={preview}
              onOrdersCopied={() => {
                void loadOrders();
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
