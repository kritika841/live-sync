"use client";

import { useEffect, useState, useMemo } from "react";
import {
  ClipboardCopy,
  ClipboardCheck,
  RotateCcw,
  Search,
  Check,
  AlertCircle,
  Clock,
  Sparkles,
} from "lucide-react";

interface CopiedOrderItem {
  id: number | string;
  channelOrderId: string;
  channelName?: string;
  customerName?: string;
  customerPhone?: string;
  customerCity?: string;
  customerState?: string;
  orderDate: string;
  status: string;
  paymentMethod?: string;
  total?: number;
  copiedAt?: string;
  copiedByName?: string;
  copiedCount?: number;
  products?: Array<{ name?: string; sku?: string; quantity?: number }>;
}

interface CopiedLogItem {
  id: number | string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  orderCount: number;
  channelOrderIds: string;
  orderIds: string[];
  tab?: string;
  createdAt: string;
}

interface CopiedStats {
  uncopiedNewCount: number;
  totalCopiedCount: number;
  totalCopyBatches: number;
  lastCopy: {
    actorName?: string;
    actorId?: string;
    actorRole?: string;
    orderCount?: number;
    createdAt?: string;
  } | null;
}

interface CopiedLogsData {
  stats: CopiedStats;
  uncopiedOrders: CopiedOrderItem[];
  copiedOrders: CopiedOrderItem[];
  logs: CopiedLogItem[];
}

const emptyData: CopiedLogsData = {
  stats: {
    uncopiedNewCount: 0,
    totalCopiedCount: 0,
    totalCopyBatches: 0,
    lastCopy: null,
  },
  uncopiedOrders: [],
  copiedOrders: [],
  logs: [],
};

function formatDate(value?: string) {
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

const formatCurrency = (value?: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    value || 0
  );

export default function CopiedLogsPanel({
  active,
  preview = false,
  onOrdersCopied,
}: {
  active: boolean;
  preview?: boolean;
  onOrdersCopied?: () => void;
}) {
  const [data, setData] = useState<CopiedLogsData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [subTab, setSubTab] = useState<"uncopied" | "copied" | "history">("uncopied");
  const [search, setSearch] = useState("");
  const [selectedUncopiedIds, setSelectedUncopiedIds] = useState<Set<string | number>>(new Set());
  const [toastMessage, setToastMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [copiedIdFeedback, setCopiedIdFeedback] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage(""), 3500);
  }

  async function loadData() {
    if (preview) {
      setData({
        stats: {
          uncopiedNewCount: 14,
          totalCopiedCount: 186,
          totalCopyBatches: 28,
          lastCopy: {
            actorName: "Admin",
            actorRole: "admin",
            orderCount: 8,
            createdAt: new Date().toISOString(),
          },
        },
        uncopiedOrders: [
          {
            id: 101,
            channelOrderId: "SI08101",
            channelName: "Shopify_5",
            customerName: "Rahul Sharma",
            customerPhone: "+91 98765 43210",
            customerCity: "Mumbai",
            customerState: "Maharashtra",
            orderDate: new Date().toISOString(),
            status: "New",
            paymentMethod: "Prepaid",
            total: 1499,
            products: [{ name: "Karungali Malai 8mm", sku: "KM-8MM", quantity: 1 }],
          },
          {
            id: 102,
            channelOrderId: "SI08102",
            channelName: "Shopify_5",
            customerName: "Pooja Patel",
            customerPhone: "+91 98220 11223",
            customerCity: "Ahmedabad",
            customerState: "Gujarat",
            orderDate: new Date(Date.now() - 3600000).toISOString(),
            status: "New",
            paymentMethod: "COD",
            total: 2299,
            products: [{ name: "Rudraksha Bracelet Silver", sku: "RB-SLV", quantity: 1 }],
          },
        ],
        copiedOrders: [
          {
            id: 100,
            channelOrderId: "SI08100",
            channelName: "Shopify_5",
            customerName: "Amit Kumar",
            customerPhone: "+91 91234 56789",
            customerCity: "Delhi",
            customerState: "Delhi",
            orderDate: new Date(Date.now() - 7200000).toISOString(),
            status: "New",
            paymentMethod: "Prepaid",
            total: 999,
            copiedAt: new Date(Date.now() - 1800000).toISOString(),
            copiedByName: "Admin",
            copiedCount: 1,
            products: [{ name: "Incense Cones Pack", sku: "IC-PK", quantity: 2 }],
          },
        ],
        logs: [
          {
            id: 1,
            actorName: "Admin",
            actorRole: "admin",
            orderCount: 8,
            channelOrderIds: "SI08100,SI08099,SI08098,SI08097",
            orderIds: ["SI08100", "SI08099", "SI08098", "SI08097"],
            tab: "new",
            createdAt: new Date(Date.now() - 1800000).toISOString(),
          },
        ],
      });
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/orders/copied");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load copied logs (${res.status})`);
      }
      const json: CopiedLogsData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading copied logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [active, preview]);

  // Handle single ID copy
  async function copySingleOrderId(order: CopiedOrderItem) {
    const rawId = order.channelOrderId.replace(/^#+/, "").trim();
    if (!rawId) return;

    try {
      await navigator.clipboard.writeText(rawId);
      setCopiedIdFeedback(String(order.id));
      window.setTimeout(() => setCopiedIdFeedback(null), 1800);
      showToast(`Copied #${rawId} to clipboard`);

      if (!preview) {
        await fetch("/api/orders/copied", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderIds: [order.id],
            channelOrderIds: [rawId],
            tab: "copied_panel",
          }),
        });
        void loadData();
        onOrdersCopied?.();
      }
    } catch {
      setError("Failed to copy order ID to clipboard");
    }
  }

  // Handle copying selected uncopied IDs
  async function copySelectedUncopied() {
    if (selectedUncopiedIds.size === 0) return;
    setActionBusy(true);

    const selectedOrders = data.uncopiedOrders.filter((o) => selectedUncopiedIds.has(o.id));
    const idsString = selectedOrders.map((o) => o.channelOrderId.replace(/^#+/, "").trim()).join(",");

    try {
      await navigator.clipboard.writeText(idsString);
      showToast(`Copied ${selectedOrders.length} order IDs to clipboard`);

      if (!preview) {
        await fetch("/api/orders/copied", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderIds: selectedOrders.map((o) => o.id),
            channelOrderIds: selectedOrders.map((o) => o.channelOrderId.replace(/^#+/, "").trim()),
            tab: "copied_panel_selected",
          }),
        });
        setSelectedUncopiedIds(new Set());
        void loadData();
        onOrdersCopied?.();
      }
    } catch {
      setError("Failed to copy to clipboard");
    } finally {
      setActionBusy(false);
    }
  }

  // Handle Copy All Uncopied IDs in one click
  async function copyAllUncopied() {
    if (data.uncopiedOrders.length === 0) return;
    setActionBusy(true);

    try {
      let idsToCopy = data.uncopiedOrders.map((o) => o.channelOrderId.replace(/^#+/, "").trim());

      if (!preview) {
        const res = await fetch("/api/orders/copied", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            copyAllUncopied: true,
            tab: "copied_panel_all",
          }),
        });
        if (!res.ok) throw new Error("Could not process batch copy");
        const resJson = await res.json();
        if (Array.isArray(resJson.channelOrderIds) && resJson.channelOrderIds.length > 0) {
          idsToCopy = resJson.channelOrderIds;
        }
      }

      await navigator.clipboard.writeText(idsToCopy.join(","));
      showToast(`Copied all ${idsToCopy.length} uncopied order IDs to clipboard!`);
      setSelectedUncopiedIds(new Set());
      void loadData();
      onOrdersCopied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy all uncopied order IDs");
    } finally {
      setActionBusy(false);
    }
  }

  // Handle copying IDs from an existing log entry
  async function copyHistoryLogBatch(log: CopiedLogItem) {
    const ids = log.orderIds && log.orderIds.length > 0
      ? log.orderIds.join(",")
      : log.channelOrderIds;
    if (!ids) return;

    try {
      await navigator.clipboard.writeText(ids);
      showToast(`Re-copied ${log.orderCount} order IDs from log batch`);
    } catch {
      setError("Failed to copy to clipboard");
    }
  }

  // Filtered orders based on search
  const filteredUncopied = useMemo(() => {
    if (!search) return data.uncopiedOrders;
    const s = search.toLowerCase();
    return data.uncopiedOrders.filter(
      (o) =>
        o.channelOrderId.toLowerCase().includes(s) ||
        (o.customerName && o.customerName.toLowerCase().includes(s)) ||
        (o.customerPhone && o.customerPhone.includes(s))
    );
  }, [data.uncopiedOrders, search]);

  const filteredCopied = useMemo(() => {
    if (!search) return data.copiedOrders;
    const s = search.toLowerCase();
    return data.copiedOrders.filter(
      (o) =>
        o.channelOrderId.toLowerCase().includes(s) ||
        (o.customerName && o.customerName.toLowerCase().includes(s)) ||
        (o.copiedByName && o.copiedByName.toLowerCase().includes(s))
    );
  }, [data.copiedOrders, search]);

  const filteredLogs = useMemo(() => {
    if (!search) return data.logs;
    const s = search.toLowerCase();
    return data.logs.filter(
      (l) =>
        l.channelOrderIds.toLowerCase().includes(s) ||
        (l.actorName && l.actorName.toLowerCase().includes(s)) ||
        (l.tab && l.tab.toLowerCase().includes(s))
    );
  }, [data.logs, search]);

  // Toggle selection for uncopied
  function toggleSelectUncopied(id: string | number) {
    setSelectedUncopiedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllUncopied() {
    if (selectedUncopiedIds.size === filteredUncopied.length && filteredUncopied.length > 0) {
      setSelectedUncopiedIds(new Set());
    } else {
      setSelectedUncopiedIds(new Set(filteredUncopied.map((o) => o.id)));
    }
  }

  return (
    <section className={`panel overflow-hidden transition-all duration-200 ${!active ? "view-hidden" : ""}`}>
      {/* HEADER */}
      <header className="border-b border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary border border-primary/20">
                <Sparkles size={11} /> Admin Only
              </span>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Order ID Tracking</p>
            </div>
            <h2 className="text-xl font-bold text-foreground mt-1 flex items-center gap-2">
              <ClipboardCheck className="text-primary size-5" />
              Copied Orders & Activity Log
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Review which order IDs have been copied, discover uncopied new orders, and audit clipboard export sessions.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition shadow-xs disabled:opacity-50"
              title="Refresh copied log data"
            >
              <RotateCcw size={14} className={loading ? "animate-spin text-primary" : "text-muted-foreground"} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-5 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
          <Check size={14} className="text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ERROR ALERT */}
      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-5 py-2.5 text-xs text-destructive flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertCircle size={14} />
            {error}
          </span>
          <button onClick={() => setError("")} className="hover:underline font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-5 bg-muted/20 border-b border-border">
        {/* CARD 1: UNCOPIED NEW ORDERS */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSubTab("uncopied")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSubTab("uncopied"); } }}
          className={`cursor-pointer rounded-xl border p-4 transition-all duration-150 ${
            subTab === "uncopied"
              ? "bg-card border-primary/50 shadow-sm ring-1 ring-primary/30"
              : "bg-card/70 border-border hover:bg-card hover:border-border/80"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase text-[10px] tracking-wider">Uncopied New Orders</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                data.stats.uncopiedNewCount > 0
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {data.stats.uncopiedNewCount > 0 ? "Needs Copying" : "All Copied"}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black tabular-nums text-foreground">
              {data.stats.uncopiedNewCount}
            </span>
            {data.stats.uncopiedNewCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void copyAllUncopied();
                }}
                disabled={actionBusy}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:bg-primary/90 transition shadow-xs"
                title="Copy all uncopied order IDs right now"
              >
                <ClipboardCopy size={12} />
                Copy All
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">New orders waiting for ID copy</p>
        </div>

        {/* CARD 2: COPIED ORDERS */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSubTab("copied")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSubTab("copied"); } }}
          className={`cursor-pointer rounded-xl border p-4 transition-all duration-150 ${
            subTab === "copied"
              ? "bg-card border-primary/50 shadow-sm ring-1 ring-primary/30"
              : "bg-card/70 border-border hover:bg-card hover:border-border/80"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase text-[10px] tracking-wider">Copied Orders</span>
            <span className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-bold">
              ✓ Logged
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black tabular-nums text-foreground">
              {data.stats.totalCopiedCount}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Orders with IDs successfully copied</p>
        </div>

        {/* CARD 3: TOTAL COPY BATCHES */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSubTab("history")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSubTab("history"); } }}
          className={`cursor-pointer rounded-xl border p-4 transition-all duration-150 ${
            subTab === "history"
              ? "bg-card border-primary/50 shadow-sm ring-1 ring-primary/30"
              : "bg-card/70 border-border hover:bg-card hover:border-border/80"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase text-[10px] tracking-wider">Copy Operations</span>
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">
              Sessions
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black tabular-nums text-foreground">
              {data.stats.totalCopyBatches}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Audit log of clipboard export sessions</p>
        </div>

        {/* CARD 4: LAST COPY ACTIVITY */}
        <div className="rounded-xl border border-border bg-card/70 p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase text-[10px] tracking-wider">Last Copy Event</span>
            <Clock size={13} className="text-muted-foreground" />
          </div>
          <div className="mt-2">
            <span className="block text-sm font-bold text-foreground truncate">
              {data.stats.lastCopy?.createdAt ? formatDate(data.stats.lastCopy.createdAt) : "None yet"}
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground truncate">
              {data.stats.lastCopy
                ? `${data.stats.lastCopy.actorName || "Admin"} · ${data.stats.lastCopy.orderCount || 0} order(s)`
                : "No orders copied yet"}
            </span>
          </div>
        </div>
      </div>

      {/* SUB-TABS NAVIGATION & SEARCH BAR */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg border border-border/60">
          <button
            onClick={() => setSubTab("uncopied")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              subTab === "uncopied"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>New Orders (Uncopied)</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                data.stats.uncopiedNewCount > 0
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                  : "bg-muted-foreground/15 text-muted-foreground"
              }`}
            >
              {data.stats.uncopiedNewCount}
            </span>
          </button>

          <button
            onClick={() => setSubTab("copied")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              subTab === "copied"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>Copied Orders</span>
            <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.2 text-[10px] font-bold text-muted-foreground">
              {data.copiedOrders.length}
            </span>
          </button>

          <button
            onClick={() => setSubTab("history")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              subTab === "history"
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>Copy History Log</span>
            <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.2 text-[10px] font-bold text-muted-foreground">
              {data.logs.length}
            </span>
          </button>
        </div>

        {/* SEARCH BOX */}
        <div className="relative min-w-[240px] max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search order #, customer, actor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-card py-1.5 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* SUB-TAB 1: UNCOPIED NEW ORDERS */}
      {subTab === "uncopied" && (
        <div>
          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-muted/30 border-b border-border text-xs">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedUncopiedIds.size > 0 && selectedUncopiedIds.size === filteredUncopied.length}
                  onChange={toggleSelectAllUncopied}
                  className="size-4 rounded border-input accent-primary cursor-pointer"
                />
                <span>Select all ({filteredUncopied.length})</span>
              </label>
              {selectedUncopiedIds.size > 0 && (
                <span className="font-semibold text-primary">{selectedUncopiedIds.size} selected</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {selectedUncopiedIds.size > 0 && (
                <button
                  onClick={() => void copySelectedUncopied()}
                  disabled={actionBusy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-card px-3 py-1 text-xs font-semibold text-foreground hover:bg-muted shadow-xs"
                >
                  <ClipboardCopy size={13} className="text-primary" />
                  Copy Selected IDs ({selectedUncopiedIds.size})
                </button>
              )}
              {filteredUncopied.length > 0 && (
                <button
                  onClick={() => void copyAllUncopied()}
                  disabled={actionBusy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 shadow-xs"
                >
                  <Sparkles size={13} />
                  Copy All {filteredUncopied.length} IDs
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto min-h-[300px] max-h-[600px] overflow-y-auto">
            <table className="w-full text-left text-sm border-collapse min-w-[900px]">
              <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 w-10"></th>
                  <th className="px-4 py-2.5">Order</th>
                  <th className="px-4 py-2.5">Customer</th>
                  <th className="px-4 py-2.5">Products</th>
                  <th className="px-4 py-2.5">Order Date</th>
                  <th className="px-4 py-2.5">Payment</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUncopied.map((order) => {
                  const isSelected = selectedUncopiedIds.has(order.id);
                  const firstProduct = order.products?.[0];
                  const isFeedback = copiedIdFeedback === String(order.id);
                  return (
                    <tr
                      key={order.id}
                      className={`transition-colors ${
                        isSelected ? "bg-accent/25 hover:bg-accent/35" : "bg-card hover:bg-muted/30"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectUncopied(order.id)}
                          className="size-4 rounded border-input accent-primary cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <strong className="block font-mono text-xs font-bold text-foreground">
                              #{order.channelOrderId}
                            </strong>
                            <span className="block text-[11px] text-muted-foreground">
                              {order.channelName || "Shopify"}
                            </span>
                          </div>
                          <span className="rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                            Not copied
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <strong className="block text-xs font-semibold text-foreground">
                          {order.customerName || "—"}
                        </strong>
                        <small className="block text-[11px] text-muted-foreground">
                          {[order.customerCity, order.customerState].filter(Boolean).join(", ") ||
                            order.customerPhone ||
                            "—"}
                        </small>
                      </td>
                      <td className="px-4 py-3">
                        <strong className="block text-xs font-medium text-foreground truncate max-w-xs">
                          {firstProduct?.name || "—"}
                        </strong>
                        <small className="block text-[10px] text-muted-foreground">
                          {firstProduct?.sku ? `SKU ${firstProduct.sku}` : ""}
                          {order.products && order.products.length > 1
                            ? ` · +${order.products.length - 1} more`
                            : ""}
                        </small>
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground tabular-nums">
                        {formatDate(order.orderDate)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                            order.paymentMethod?.toLowerCase() === "prepaid"
                              ? "bg-accent text-accent-foreground"
                              : "bg-warning/15 text-warning"
                          }`}
                        >
                          {order.paymentMethod || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                        {formatCurrency(order.total)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => void copySingleOrderId(order)}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition shadow-2xs ${
                            isFeedback
                              ? "bg-emerald-600 text-white"
                              : "border border-border bg-card text-foreground hover:bg-muted"
                          }`}
                        >
                          {isFeedback ? <Check size={12} /> : <ClipboardCopy size={12} />}
                          <span>{isFeedback ? "Copied!" : "Copy ID"}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!loading && filteredUncopied.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-xs text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="size-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                          <Check size={20} />
                        </div>
                        <strong className="text-sm font-semibold text-foreground">
                          {search ? "No matching uncopied orders found" : "All new orders have been copied!"}
                        </strong>
                        <p className="text-xs text-muted-foreground max-w-sm">
                          {search
                            ? "Try adjusting your search keywords."
                            : "There are no uncopied new orders at this time. All order IDs have been processed."}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: COPIED ORDERS */}
      {subTab === "copied" && (
        <div className="overflow-x-auto min-h-[300px] max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-sm border-collapse min-w-[900px]">
            <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="px-4 py-2.5">Order</th>
                <th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5">Products</th>
                <th className="px-4 py-2.5">Order Date</th>
                <th className="px-4 py-2.5">Copied At</th>
                <th className="px-4 py-2.5">Copied By</th>
                <th className="px-4 py-2.5 text-center">Times Copied</th>
                <th className="px-4 py-2.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredCopied.map((order) => {
                const firstProduct = order.products?.[0];
                const isFeedback = copiedIdFeedback === String(order.id);
                return (
                  <tr key={order.id} className="bg-card hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <strong className="block font-mono text-xs font-bold text-foreground">
                            #{order.channelOrderId}
                          </strong>
                          <span className="block text-[11px] text-muted-foreground">
                            {order.channelName || "Shopify"}
                          </span>
                        </div>
                        <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                          ✓ Copied
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <strong className="block text-xs font-semibold text-foreground">
                        {order.customerName || "—"}
                      </strong>
                      <small className="block text-[11px] text-muted-foreground">
                        {[order.customerCity, order.customerState].filter(Boolean).join(", ") ||
                          order.customerPhone ||
                          "—"}
                      </small>
                    </td>
                    <td className="px-4 py-3">
                      <strong className="block text-xs font-medium text-foreground truncate max-w-xs">
                        {firstProduct?.name || "—"}
                      </strong>
                      <small className="block text-[10px] text-muted-foreground">
                        {firstProduct?.sku ? `SKU ${firstProduct.sku}` : ""}
                      </small>
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground tabular-nums">
                      {formatDate(order.orderDate)}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground tabular-nums">
                      <div className="font-semibold">{formatDate(order.copiedAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
                        {order.copiedByName || "User"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-xs font-semibold text-foreground">
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">
                        {order.copiedCount || 1}x
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => void copySingleOrderId(order)}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition shadow-2xs ${
                          isFeedback
                            ? "bg-emerald-600 text-white"
                            : "border border-border bg-card text-foreground hover:bg-muted"
                        }`}
                      >
                        {isFeedback ? <Check size={12} /> : <ClipboardCopy size={12} />}
                        <span>{isFeedback ? "Copied!" : "Re-copy"}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}

              {!loading && filteredCopied.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-xs text-muted-foreground">
                    No copied orders found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUB-TAB 3: COPY HISTORY LOG */}
      {subTab === "history" && (
        <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
          {filteredLogs.map((log) => (
            <article
              key={log.id}
              className="flex flex-wrap items-center justify-between gap-4 p-5 hover:bg-muted/20 transition-colors"
            >
              <div className="flex-1 min-w-[280px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-foreground">
                    {formatDate(log.createdAt)}
                  </span>
                  <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wide">
                    {log.actorRole || "admin"}: {log.actorName || log.actorId}
                  </span>
                  {log.tab && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Tab: {log.tab}
                    </span>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-2">
                  <strong className="text-sm font-semibold text-foreground">
                    Copied {log.orderCount} order ID{log.orderCount > 1 ? "s" : ""}
                  </strong>
                </div>

                {/* Preview IDs */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 max-h-20 overflow-y-auto">
                  {(log.orderIds && log.orderIds.length > 0
                    ? log.orderIds
                    : log.channelOrderIds.split(",")
                  )
                    .slice(0, 15)
                    .map((id, idx) => (
                      <span
                        key={idx}
                        className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground"
                      >
                        #{id.trim()}
                      </span>
                    ))}
                  {log.orderCount > 15 && (
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      +{log.orderCount - 15} more
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => void copyHistoryLogBatch(log)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition shadow-xs"
                  title="Re-copy this batch of IDs to clipboard"
                >
                  <ClipboardCopy size={13} className="text-primary" />
                  <span>Re-copy IDs</span>
                </button>
              </div>
            </article>
          ))}

          {!loading && filteredLogs.length === 0 && (
            <div className="py-16 text-center text-xs text-muted-foreground">
              No copy history logs recorded yet. When you copy order IDs, sessions will appear here.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
