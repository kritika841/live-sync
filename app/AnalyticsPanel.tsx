"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Filter,
  Layers,
  MapPin,
  PackageCheck,
  Percent,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Truck,
  X,
} from "lucide-react";

interface MetricItem {
  count: number;
  percent: number;
}

interface AnalyticsData {
  statusBreakdown?: Array<{ status: string; count: number; attempted: boolean; shipped: boolean }>;
  metrics: {
    total: MetricItem;
    delivered: MetricItem;
    deliveryRate: number;

    shipped: MetricItem;
    openPopulation?: MetricItem;
    openDeliveryRate?: number;
    openOrdersDeliveryRate: number;
    shippedDeliveryRate?: number;

    closed: MetricItem;
    closedOrdersDeliveryRate: number;

    rto: MetricItem;
    closedRto?: MetricItem;
    rtoRate: number;
    rtoOfTotal: MetricItem;

    inTransit: MetricItem;
    inTransitZeroAttempts: MetricItem;
    inTransitWithAttempts: MetricItem;

    outForDelivery: MetricItem;

    firstAttemptDelivered: MetricItem;
    secondAttemptDelivered: MetricItem;
    thirdAttemptDelivered: MetricItem;
    laterAttemptDelivered: MetricItem;

    cod: MetricItem;
    prepaid: MetricItem;
    codRatio: number;
    prepaidRatio: number;
    codDeliveryRate: number;
    prepaidDeliveryRate: number;
    codClosedDeliveryRate: number;
    prepaidClosedDeliveryRate: number;
    codShipped: number;
    codDelivered: number;
    prepaidShipped: number;
    prepaidDelivered: number;

    ndr: MetricItem;
    closedNdr?: MetricItem;
    totalNdrExperienced: MetricItem;
    ndrDelivered: MetricItem;
    ndrDeliveryRate: number;

    avgShippedTatDays: number | null;
    avgOrderTatDays: number | null;

    nonShipped?: MetricItem;
    cancelled?: MetricItem;
  };
  financials: {
    deliveredRevenue: number;
    avgShippingCost: number;
    deliveredShippingCostCount: number;
    avgDeliveredOrderValue: number;
    deliveredCount: number;
  };
  byCourier?: Array<{ name: string; total: number; delivered: number; outcomes: number; rate: number }>;
  byState?: Array<{ name: string; total: number; delivered: number; outcomes: number; rate: number }>;
  ndrReasons: Array<{ reason: string; count: number; percent: number }>;
  courierWise: Array<{
    name: string;
    total: number;
    shipped: number;
    delivered: number;
    rto: number;
    ndr: number;
    closed: number;
    deliveryRate: number;
    closedDeliveryRate: number;
    rtoRate: number;
    avgTatDays: number | null;
  }>;
  stateWise: Array<{
    state: string;
    total: number;
    shipped: number;
    delivered: number;
    rto: number;
    closed: number;
    deliveryRate: number;
    closedDeliveryRate: number;
    rtoRate: number;
  }>;
  dateWise: Array<{
    date: string;
    total: number;
    shipped: number;
    delivered: number;
    rto: number;
    ndr: number;
    inTransit: number;
    outForDelivery: number;
    deliveryRate: number;
    rtoRate: number;
  }>;
  productWise: Array<{
    name: string;
    orderCount: number;
    shipped: number;
    delivered: number;
    rto: number;
    deliveryRate: number;
    closedDeliveryRate: number;
  }>;
  filterOptions: {
    couriers: string[];
    states: string[];
  };
  dataQuality: {
    source: string;
    dateBasis: string;
    orderCount: number;
    lastSyncAt: string;
    syncStatus: string;
    lastSyncCount: number;
    lastSyncError: string;
  };
}

export interface OfdOrder {
  id: number;
  channelOrderId: string;
  customerName: string;
  customerCity: string;
  customerState: string;
  status: string;
  paymentMethod: string;
  total: number;
  awb: string;
  courier: string;
  shippedAt: string;
  firstOutForDeliveryAt: string;
  outForDeliveryAt: string;
  deliveredAt: string;
  ndrReason: string;
  ndrAttempts: number;
  ndrRaisedAt: string;
  shippingCost: number;
  attemptNumber: number;
  previousUndelivered: boolean;
}

export interface OfdData {
  date: string;
  metrics: Record<string, MetricItem>;
  attemptBasis?: string;
  trackingHistory?: { status: string; error?: string };
  orders: OfdOrder[];
}

interface AnalyticsPanelProps {
  active: boolean;
  mode?: "overview" | "today_ofd";
  preview?: boolean;
  isAdmin?: boolean;
}

const formatNumber = (value: number) => new Intl.NumberFormat("en-IN").format(value || 0);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    value || 0
  );

function formatDateTime(value: string) {
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

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function getTodayString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getPastDateString(daysCount: number) {
  // Shiprocket uses inclusive calendar days ending on today (e.g., 30 days is today - 29 days through today)
  const d = new Date(Date.now() - Math.max(0, daysCount - 1) * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function AnalyticsPanel({ active, mode = "overview", preview = false }: AnalyticsPanelProps) {
  const [activeMode, setActiveMode] = useState<"overview" | "today_ofd">(mode);

  useEffect(() => {
    if (mode) setActiveMode(mode);
  }, [mode]);

  const todayStr = useMemo(() => getTodayString(), []);
  const [datePreset, setDatePreset] = useState<"today" | "yesterday" | "7d" | "14d" | "30d" | "mtd" | "all" | "custom">("30d");
  const [from, setFrom] = useState(() => getPastDateString(30));
  const [to, setTo] = useState(todayStr);

  const [courier, setCourier] = useState("");
  const [payment, setPayment] = useState("");
  const [state, setState] = useState("");

  const [activeTab, setActiveTab] = useState<"couriers" | "dates" | "states" | "ndr" | "products">(
    "couriers"
  );
  const [subSearch, setSubSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");

  // Today's OFD states
  const [ofdDate, setOfdDate] = useState(todayStr);
  const [ofdOutcome, setOfdOutcome] = useState<
    "all" | "delivered" | "undelivered" | "out" | "unresolved" | "attempt1" | "attempt2" | "attempt3"
  >("all");
  const [ofdData, setOfdData] = useState<OfdData | null>(null);
  const [ofdLoading, setOfdLoading] = useState(false);
  const [ofdError, setOfdError] = useState("");

  async function fetchOfd(refresh = false) {
    if (preview) return;
    setOfdLoading(true);
    setOfdError("");
    try {
      const res = await fetch(`/api/analytics?mode=today_ofd&date=${ofdDate}${refresh ? "&refresh=1" : ""}`, {
        cache: "no-store",
        headers: { "x-requested-with": "satmi-analytics" },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to load OFD records");
      }
      const json = (await res.json()) as OfdData;
      setOfdData(json);
    } catch (err) {
      setOfdError(err instanceof Error ? err.message : "Error loading OFD records");
    } finally {
      setOfdLoading(false);
    }
  }

  useEffect(() => {
    if (active && activeMode === "today_ofd") {
      void fetchOfd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeMode, ofdDate]);

  // Handle Preset Change
  const applyPreset = (preset: "today" | "yesterday" | "7d" | "14d" | "30d" | "mtd" | "all" | "custom") => {
    setDatePreset(preset);
    if (preset === "today") {
      setFrom(todayStr);
      setTo(todayStr);
    } else if (preset === "yesterday") {
      const yesterday = getPastDateString(2);
      setFrom(yesterday);
      setTo(yesterday);
    } else if (preset === "7d") {
      setFrom(getPastDateString(7));
      setTo(todayStr);
    } else if (preset === "14d") {
      setFrom(getPastDateString(14));
      setTo(todayStr);
    } else if (preset === "30d") {
      setFrom(getPastDateString(30));
      setTo(todayStr);
    } else if (preset === "mtd") {
      const startOfMonth = `${todayStr.slice(0, 7)}-01`;
      setFrom(startOfMonth);
      setTo(todayStr);
    } else if (preset === "all") {
      setFrom("");
      setTo("");
    }
  };

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (courier) params.set("courier", courier);
    if (payment) params.set("payment", payment);
    if (state) params.set("state", state);
    return params.toString();
  }, [from, to, courier, payment, state]);

  async function fetchAnalytics(refresh = false) {
    if (preview) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/analytics?${queryParams}${refresh ? "&refresh=1" : ""}`, {
        cache: "no-store",
        headers: { "x-requested-with": "satmi-analytics" },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to load analytics data");
      }
      const json = (await res.json()) as AnalyticsData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active && activeMode === "overview") {
      void fetchAnalytics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeMode, queryParams]);

  const metrics = data?.metrics;

  // Filtered lists for sub-tables
  const filteredCouriers = useMemo(() => {
    if (!data?.courierWise) return [];
    if (!subSearch.trim()) return data.courierWise;
    const term = subSearch.toLowerCase();
    return data.courierWise.filter((c) => c.name.toLowerCase().includes(term));
  }, [data?.courierWise, subSearch]);

  const filteredStates = useMemo(() => {
    if (!data?.stateWise) return [];
    if (!subSearch.trim()) return data.stateWise;
    const term = subSearch.toLowerCase();
    return data.stateWise.filter((s) => s.state.toLowerCase().includes(term));
  }, [data?.stateWise, subSearch]);

  const filteredProducts = useMemo(() => {
    if (!data?.productWise) return [];
    if (!subSearch.trim()) return data.productWise;
    const term = subSearch.toLowerCase();
    return data.productWise.filter((p) => p.name.toLowerCase().includes(term));
  }, [data?.productWise, subSearch]);

  const filteredDates = useMemo(() => {
    if (!data?.dateWise) return [];
    if (!subSearch.trim()) return data.dateWise;
    const term = subSearch.toLowerCase();
    return data.dateWise.filter((d) => d.date.includes(term));
  }, [data?.dateWise, subSearch]);

  const filteredNdrReasons = useMemo(() => {
    if (!data?.ndrReasons) return [];
    if (!subSearch.trim()) return data.ndrReasons;
    const term = subSearch.toLowerCase();
    return data.ndrReasons.filter((r) => r.reason.toLowerCase().includes(term));
  }, [data?.ndrReasons, subSearch]);

  const maxNdrCount = useMemo(() => {
    if (!data?.ndrReasons || data.ndrReasons.length === 0) return 1;
    return Math.max(...data.ndrReasons.map((r) => r.count), 1);
  }, [data?.ndrReasons]);

  if (activeMode === "today_ofd") {
    const ofdMetrics = ofdData?.metrics || {};
    const historical = ofdDate < todayStr;
    const shownOrders = (ofdData?.orders || []).filter((order) => {
      if (ofdOutcome === "delivered") return /^(DELIVERED|DELIVERED TO CUSTOMER)$/i.test(order.status);
      if (ofdOutcome === "undelivered") return /UNDELIVERED|NDR|RTO|RETURN TO ORIGIN/i.test(order.status);
      if (ofdOutcome === "out") return /^OUT FOR DELIVERY$/i.test(order.status);
      if (ofdOutcome === "unresolved") return /^UNRESOLVED AFTER OFD$/i.test(order.status);
      if (ofdOutcome.startsWith("attempt")) return order.attemptNumber === Number(ofdOutcome.slice(-1));
      return true;
    });

    return (
      <section className={`panel overflow-hidden ${!active ? "view-hidden" : ""}`}>
        {/* HEADER */}
        <header className="border-b border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Delivery Operations</p>
              </div>
              <h2 className="text-xl font-bold text-foreground mt-0.5">Today’s Out For Delivery (OFD)</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Real-time tracking of packages currently out for delivery, repeat attempts, failed attempts and final outcomes
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Mode Switcher */}
              <div className="flex items-center gap-1 p-1 bg-muted rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setActiveMode("overview")}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md transition text-muted-foreground hover:text-foreground"
                >
                  <BarChart3 size={13} className="inline mr-1.5" />
                  Analytics Overview
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMode("today_ofd")}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md transition bg-card text-foreground shadow-xs font-bold"
                >
                  <Truck size={13} className="inline mr-1.5" />
                  Today’s OFD
                </button>
              </div>

              <button
                type="button"
                onClick={() => void fetchOfd(true)}
                disabled={ofdLoading}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition shadow-xs disabled:opacity-50"
                title="Refresh OFD Activity"
              >
                <RefreshCw size={14} className={ofdLoading ? "animate-spin text-primary" : "text-muted-foreground"} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Date Picker Bar */}
          <div className="mt-4 pt-4 border-t border-border/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 rounded-lg border border-border">
                <Calendar size={13} className="text-primary shrink-0" />
                <span>OFD Date:</span>
                <input
                  type="date"
                  value={ofdDate}
                  max={todayStr}
                  onChange={(e) => setOfdDate(e.target.value)}
                  className="bg-transparent border-0 text-foreground text-xs font-semibold p-0 focus:outline-none cursor-pointer"
                />
              </label>
              {ofdDate !== todayStr && (
                <button
                  type="button"
                  onClick={() => setOfdDate(todayStr)}
                  className="text-xs font-medium text-primary hover:underline px-2"
                >
                  Jump to today
                </button>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              {historical ? (
                <span className="text-amber-600 dark:text-amber-400 font-medium">Historical OFD archive</span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live today scans
                </span>
              )}
            </div>
          </div>
        </header>

        {/* ERROR */}
        {ofdError && (
          <div className="m-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive flex items-center gap-3">
            <AlertTriangle size={18} className="shrink-0" />
            <p className="text-xs font-semibold">{ofdError}</p>
          </div>
        )}

        <div className="p-5 space-y-6">
          {ofdLoading && !ofdData && (
            <div className="py-24 text-center space-y-3">
              <RefreshCw size={28} className="animate-spin text-primary mx-auto" />
              <p className="text-xs font-medium text-muted-foreground">Loading live OFD activity…</p>
            </div>
          )}

          {ofdData && (
            <>
              {/* OFD KPI METRICS GRID */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-muted-foreground">Went out for delivery</p>
                  <strong className="text-xl font-bold text-foreground mt-1 block">
                    {formatNumber(ofdMetrics.total?.count || 0)}
                  </strong>
                  <small className="text-[10px] text-muted-foreground">Total orders with OFD scan</small>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Delivered</p>
                  <strong className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">
                    {ofdMetrics.delivered?.percent || 0}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">({formatNumber(ofdMetrics.delivered?.count || 0)})</span>
                  </strong>
                  <small className="text-[10px] text-muted-foreground">Successfully delivered</small>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-destructive">Undelivered</p>
                  <strong className="text-xl font-bold text-destructive mt-1 block">
                    {ofdMetrics.undelivered?.percent || 0}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">({formatNumber(ofdMetrics.undelivered?.count || 0)})</span>
                  </strong>
                  <small className="text-[10px] text-muted-foreground">Failed delivery attempts</small>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-sky-600 dark:text-sky-400">Still out for delivery</p>
                  <strong className="text-xl font-bold text-foreground mt-1 block">
                    {ofdMetrics.stillOut?.percent || 0}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">({formatNumber(ofdMetrics.stillOut?.count || 0)})</span>
                  </strong>
                  <small className="text-[10px] text-muted-foreground">
                    {historical ? "Past dates cannot remain in this category" : "Active with courier agents"}
                  </small>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-muted-foreground">1st recorded OFD day</p>
                  <strong className="text-xl font-bold text-foreground mt-1 block">
                    {ofdMetrics.firstAttemptOFD?.percent || 0}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">({formatNumber(ofdMetrics.firstAttemptOFD?.count || 0)})</span>
                  </strong>
                  <small className="text-[10px] text-muted-foreground">First day out</small>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">2nd recorded OFD day</p>
                  <strong className="text-xl font-bold text-foreground mt-1 block">
                    {ofdMetrics.secondAttemptOFD?.percent || 0}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">({formatNumber(ofdMetrics.secondAttemptOFD?.count || 0)})</span>
                  </strong>
                  <small className="text-[10px] text-muted-foreground">Second OFD day</small>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-orange-600 dark:text-orange-400">3rd recorded OFD day</p>
                  <strong className="text-xl font-bold text-foreground mt-1 block">
                    {ofdMetrics.thirdAttemptOFD?.percent || 0}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">({formatNumber(ofdMetrics.thirdAttemptOFD?.count || 0)})</span>
                  </strong>
                  <small className="text-[10px] text-muted-foreground">Third OFD day</small>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-purple-600 dark:text-purple-400">Previously undelivered</p>
                  <strong className="text-xl font-bold text-foreground mt-1 block">
                    {ofdMetrics.previousUndelivered?.percent || 0}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">({formatNumber(ofdMetrics.previousUndelivered?.count || 0)})</span>
                  </strong>
                  <small className="text-[10px] text-muted-foreground">Had prior failed attempt</small>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">Moved to RTO</p>
                  <strong className="text-xl font-bold text-rose-600 dark:text-rose-400 mt-1 block">
                    {ofdMetrics.rto?.percent || 0}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">({formatNumber(ofdMetrics.rto?.count || 0)})</span>
                  </strong>
                  <small className="text-[10px] text-muted-foreground">Returned after OFD</small>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <p className="text-[11px] font-medium text-zinc-500">Unresolved after OFD</p>
                  <strong className="text-xl font-bold text-foreground mt-1 block">
                    {ofdMetrics.unresolved?.percent || 0}%{" "}
                    <span className="text-xs font-normal text-muted-foreground">({formatNumber(ofdMetrics.unresolved?.count || 0)})</span>
                  </strong>
                  <small className="text-[10px] text-muted-foreground">No final delivery scan</small>
                </div>
              </div>

              {/* OFD REGISTER TABLE */}
              <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="border-b border-border bg-muted/20 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">OFD attempt register</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Latest attempt, first attempt, outcome, and NDR detail for {ofdDate}
                    </p>
                  </div>
                  <span className="rounded bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    {shownOrders.length} orders
                  </span>
                </div>

                {/* Outcome filter tabs */}
                <div className="border-b border-border px-5 py-2.5 bg-muted/10">
                  <nav className="outcome-tabs flex flex-wrap gap-1.5" aria-label="Filter OFD outcomes">
                    {(
                      [
                        ["all", "All"],
                        ["delivered", "Delivered"],
                        ["undelivered", "Undelivered / RTO"],
                        ["out", "Still OFD"],
                        ["unresolved", "Unresolved after OFD"],
                        ["attempt1", "1st attempt OFD"],
                        ["attempt2", "2nd attempt OFD"],
                        ["attempt3", "3rd attempt OFD"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setOfdOutcome(key)}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                          ofdOutcome === key
                            ? "bg-primary text-primary-foreground font-bold shadow-xs"
                            : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </nav>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                      <tr>
                        <th className="py-3 px-4">Order</th>
                        <th className="py-3 px-4">Attempt</th>
                        <th className="py-3 px-4">Recorded OFD day</th>
                        <th className="py-3 px-4">Customer</th>
                        <th className="py-3 px-4">OFD time</th>
                        <th className="py-3 px-4">First OFD</th>
                        <th className="py-3 px-4">Current outcome</th>
                        <th className="py-3 px-4">NDR reason</th>
                        <th className="py-3 px-4">AWB / Courier</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {shownOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-muted/30 transition">
                          <td className="py-3 px-4">
                            <strong className="text-foreground">#{order.channelOrderId || order.id}</strong>
                            {order.previousUndelivered && (
                              <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                Previously undelivered
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-muted text-foreground">
                              Attempt {order.attemptNumber}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-muted-foreground font-medium">
                            {order.attemptNumber ? `${order.attemptNumber} recorded OFD day` : "—"}
                          </td>
                          <td className="py-3 px-4">
                            <strong className="text-foreground">{order.customerName || "—"}</strong>
                            <span className="block text-[10px] text-muted-foreground">
                              {[order.customerCity, order.customerState].filter(Boolean).join(", ")}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">{formatDateTime(order.outForDeliveryAt)}</td>
                          <td className="py-3 px-4 text-muted-foreground">{formatDateTime(order.firstOutForDeliveryAt)}</td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-muted text-foreground">
                              {order.status || "Unknown"}
                            </span>
                            {order.deliveredAt && (
                              <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">
                                Delivered {formatDateTime(order.deliveredAt)}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <strong className="text-foreground">{order.ndrReason || "—"}</strong>
                            {order.ndrRaisedAt && (
                              <span className="block text-[10px] text-muted-foreground">
                                {formatDateTime(order.ndrRaisedAt)}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <strong className="text-foreground">{order.awb || "—"}</strong>
                            <span className="block text-[10px] text-muted-foreground">
                              {order.courier || "Not assigned"}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-foreground">
                            {formatCurrency(order.total)}
                          </td>
                        </tr>
                      ))}
                      {shownOrders.length === 0 && (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-xs text-muted-foreground">
                            No orders went out for delivery matching this filter on this date.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={`panel overflow-hidden ${!active ? "view-hidden" : ""}`}>
      {/* HEADER SECTION */}
      <header className="border-b border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Live Dashboard Analytics</p>
            </div>
            <h2 className="text-xl font-bold text-foreground mt-0.5">Delivery & Fulfillment Performance</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Live delivery success rates, open & closed order cohorts, courier efficiency, attempt funnels and NDR recovery
            </p>
            {metrics && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-semibold text-foreground">
                  <span className="text-muted-foreground font-normal">Total Shipped:</span>
                  {formatNumber(metrics.shipped.count)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <span className="text-emerald-600 dark:text-emerald-400 font-normal">Total Delivered:</span>
                  {formatNumber(metrics.delivered.count)}
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">({metrics.openOrdersDeliveryRate}%)</span>
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Mode Switcher */}
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setActiveMode("overview")}
                className="px-3 py-1.5 text-xs font-semibold rounded-md transition bg-card text-foreground shadow-xs font-bold"
              >
                <BarChart3 size={13} className="inline mr-1.5" />
                Analytics Overview
              </button>
              <button
                type="button"
                onClick={() => setActiveMode("today_ofd")}
                className="px-3 py-1.5 text-xs font-semibold rounded-md transition text-muted-foreground hover:text-foreground"
              >
                <Truck size={13} className="inline mr-1.5" />
                Today’s OFD
              </button>
            </div>

            <button
              type="button"
              onClick={() => void fetchAnalytics(true)}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition shadow-xs disabled:opacity-50"
              title="Refresh Analytics"
            >
              <RefreshCw size={14} className={loading ? "animate-spin text-primary" : "text-muted-foreground"} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* CONTROLS & FILTER BAR */}
        <div className="mt-4 pt-4 border-t border-border/60 flex flex-wrap items-center justify-between gap-3">
          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-muted rounded-lg border border-border">
            {(
              [
                { id: "today", label: "Today" },
                { id: "yesterday", label: "Yesterday" },
                { id: "7d", label: "7 Days" },
                { id: "14d", label: "14 Days" },
                { id: "30d", label: "30 Days" },
                { id: "mtd", label: "This Month" },
                { id: "all", label: "All Time" },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                  datePreset === preset.id
                    ? "bg-card text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Filters: From, To, Courier, Payment, State */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-lg border border-border">
              <Calendar size={13} className="text-primary shrink-0" />
              <input
                type="date"
                value={from}
                max={to || todayStr}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setDatePreset("custom");
                }}
                className="bg-transparent border-0 text-foreground text-xs p-0 focus:outline-none cursor-pointer"
                title="Start Date"
              />
              <span className="text-muted-foreground/60">—</span>
              <input
                type="date"
                value={to}
                min={from}
                max={todayStr}
                onChange={(e) => {
                  setTo(e.target.value);
                  setDatePreset("custom");
                }}
                className="bg-transparent border-0 text-foreground text-xs p-0 focus:outline-none cursor-pointer"
                title="End Date"
              />
            </div>

            {/* Courier Filter */}
            <select
              value={courier}
              onChange={(e) => setCourier(e.target.value)}
              className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted/50 transition focus:outline-none shadow-xs"
            >
              <option value="">All Couriers</option>
              {data?.filterOptions?.couriers?.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Payment Method Filter */}
            <select
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted/50 transition focus:outline-none shadow-xs"
            >
              <option value="">All Payments</option>
              <option value="cod">COD only</option>
              <option value="prepaid">Prepaid only</option>
            </select>

            {/* State Filter */}
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted/50 transition focus:outline-none shadow-xs max-w-[140px] truncate"
            >
              <option value="">All States</option>
              {data?.filterOptions?.states?.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {(courier || payment || state || datePreset !== "30d") && (
              <button
                type="button"
                onClick={() => {
                  setCourier("");
                  setPayment("");
                  setState("");
                  applyPreset("30d");
                }}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition rounded-md hover:bg-muted"
                title="Reset all filters"
              >
                <X size={13} />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ERROR BANNER */}
      {error && (
        <div className="m-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive flex items-center gap-3">
          <AlertTriangle size={18} className="shrink-0" />
          <p className="text-xs font-semibold">{error}</p>
        </div>
      )}

      {/* METRIC BANNER & AUDIT SUMMARY */}
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/25 px-5 py-2.5 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <span className="size-2 rounded-full bg-emerald-500" />
              <strong>{formatNumber(data.dataQuality.orderCount)} orders in this view</strong>
            </span>
            {metrics && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <span className="text-muted-foreground">Shipped:</span>
                  <strong>{formatNumber(metrics.shipped.count)}</strong>
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="text-muted-foreground">Delivered:</span>
                  <strong className="text-emerald-700 dark:text-emerald-300 font-bold">{formatNumber(metrics.delivered.count)}</strong>
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">({metrics.openOrdersDeliveryRate}%)</span>
                </span>
              </>
            )}
            <span>·</span>
            <span>{data.dataQuality.source}</span>
            <span>·</span>
            <span>{data.dataQuality.dateBasis}</span>
            {data.dataQuality.lastSyncAt && (
              <>
                <span>·</span>
                <span>Last synced: {formatDateTime(data.dataQuality.lastSyncAt)}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs font-medium">
            <span>
              Delivered Revenue:{" "}
              <strong className="text-foreground">{formatCurrency(data.financials.deliveredRevenue)}</strong>
            </span>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <div className="p-5 space-y-6">
        {loading && !data && (
          <div className="py-24 text-center space-y-3">
            <RefreshCw size={28} className="animate-spin text-primary mx-auto" />
            <p className="text-xs font-medium text-muted-foreground">Calculating high-precision delivery analytics…</p>
          </div>
        )}

        {data && metrics && (
          <>
            {/* PRIMARY HEADLINE KPI CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 1. Open Orders Delivery % */}
              <article className="rounded-xl border border-border bg-card p-4 shadow-xs relative overflow-hidden group hover:border-primary/50 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">
                      Primary Rate
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">Open Orders Delivery %</h3>
                  </div>
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <TrendingUp size={18} />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">
                    {metrics.openOrdersDeliveryRate}%
                  </strong>
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center">
                    <ArrowUpRight size={14} /> Delivered
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Delivered ÷ (All shipped statuses) × 100 · Includes RTO, undelivered and lost
                </p>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Delivered: <strong className="text-foreground">{formatNumber(metrics.delivered.count)}</strong>
                  </span>
                  <span>
                    Shipped: <strong className="text-foreground">{formatNumber(metrics.shipped.count)}</strong>
                  </span>
                </div>
              </article>

              {/* 2. Closed Orders Delivery % */}
              <article className="rounded-xl border border-border bg-card p-4 shadow-xs relative overflow-hidden group hover:border-border/80 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider">
                      Attempted Rate
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">Closed Orders Delivery %</h3>
                  </div>
                  <div className="flex size-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
                    <PackageCheck size={18} />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">
                    {metrics.closedOrdersDeliveryRate}%
                  </strong>
                  <span className="text-xs text-muted-foreground">conversion</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Delivered ÷ (Delivered + RTO + Undelivered + OFD) × 100
                </p>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Outcomes: <strong className="text-foreground">{formatNumber(metrics.closed.count)}</strong>
                  </span>
                  <span>
                    RTO + NDR:{" "}
                    <strong className="text-foreground">{formatNumber(metrics.rto.count + metrics.ndr.count)}</strong>
                  </span>
                </div>
              </article>

              {/* 3. Overall Delivery % */}
              <article className="rounded-xl border border-border bg-card p-4 shadow-xs relative overflow-hidden group hover:border-border/80 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                      Cohort Total
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">Overall Delivered %</h3>
                  </div>
                  <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                    <CheckCircle2 size={18} />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">
                    {metrics.deliveryRate}%
                  </strong>
                  <span className="text-xs text-muted-foreground">of all orders</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {formatNumber(metrics.delivered.count)} delivered out of {formatNumber(metrics.total.count)} cohort orders
                </p>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Total: <strong className="text-foreground">{formatNumber(metrics.total.count)}</strong>
                  </span>
                  <span>
                    Delivered: <strong className="text-foreground">{formatNumber(metrics.delivered.count)}</strong>
                  </span>
                </div>
              </article>

              {/* 4. RTO % */}
              <article className="rounded-xl border border-destructive/20 bg-card p-4 shadow-xs relative overflow-hidden group hover:border-destructive/40 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive uppercase tracking-wider">
                      Return Rate
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">RTO % (Return to Origin)</h3>
                  </div>
                  <div className="flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                    <TrendingDown size={18} />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-destructive">{metrics.rtoRate}%</strong>
                  <span className="text-xs text-destructive font-medium flex items-center">
                    <ArrowDownRight size={14} /> of shipped
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  RTO ÷ (All shipped statuses) × 100
                </p>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    RTO Count: <strong className="text-destructive">{formatNumber(metrics.rto.count)}</strong>
                  </span>
                  <span>
                    Total %: <strong className="text-foreground">{metrics.rtoOfTotal.percent}%</strong>
                  </span>
                </div>
              </article>
            </div>

            {/* SECONDARY PARAMETERS GRID: In Transit, OFD, NDR Recovery, Avg TAT */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* In Transit with 0 Attempts callout */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">In Transit</span>
                  <Truck size={16} className="text-indigo-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-xl font-bold text-foreground">{metrics.inTransit.percent}%</strong>
                  <span className="text-xs text-muted-foreground">({formatNumber(metrics.inTransit.count)} orders)</span>
                </div>
              </div>

              {/* Out for Delivery % */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Out for Delivery</span>
                  <PackageCheck size={16} className="text-sky-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-xl font-bold text-foreground">{metrics.outForDelivery.percent}%</strong>
                  <span className="text-xs text-muted-foreground">
                    ({formatNumber(metrics.outForDelivery.count)} orders out today)
                  </span>
                </div>
                <div className="mt-2.5 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                  <p className="text-[11px]">Active last-mile attempts currently with delivery agents.</p>
                </div>
              </div>

              {/* NDR / Undelivered Delivery Percentage (Recovery Rate) */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">NDR Recovery Delivery %</span>
                  <Percent size={16} className="text-emerald-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-xl font-bold text-foreground">{metrics.ndrDeliveryRate}%</strong>
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">delivered</span>
                </div>
                <div className="mt-2.5 rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>Delivered after NDR:</span>
                    <strong className="text-foreground">{formatNumber(metrics.ndrDelivered.count)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Total NDR experienced:</span>
                    <strong className="text-foreground">{formatNumber(metrics.totalNdrExperienced.count)}</strong>
                  </div>
                </div>
              </div>

              {/* Avg Time to Deliver (TAT) */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Avg Time to Deliver</span>
                  <Clock size={16} className="text-amber-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-xl font-bold text-foreground">
                    {metrics.avgShippedTatDays != null ? `${metrics.avgShippedTatDays} days` : "—"}
                  </strong>
                  <span className="text-xs text-muted-foreground">dispatch to door</span>
                </div>
                <div className="mt-2.5 rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>Shipped → Delivered:</span>
                    <strong className="text-foreground">
                      {metrics.avgShippedTatDays != null ? `${metrics.avgShippedTatDays} days` : "—"}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Order → Delivered:</span>
                    <strong className="text-foreground">
                      {metrics.avgOrderTatDays != null ? `${metrics.avgOrderTatDays} days` : "—"}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* ATTEMPTS BREAKDOWN & PAYMENT RATIOS SPLIT */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Delivery Attempts Breakdown Card */}
              <article className="rounded-xl border border-border bg-card p-5 shadow-xs">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Delivery Attempt Breakdown</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Success rate categorized by number of attempts required to achieve delivery
                    </p>
                  </div>
                  <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground uppercase tracking-wide">
                    Funnel
                  </span>
                </div>

                <div className="mt-4 space-y-3.5">
                  {/* First Attempt */}
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-foreground flex items-center gap-2">
                        <span className="size-2 rounded-full bg-emerald-500" />
                        1st Attempt Delivery %
                      </span>
                      <span className="text-foreground">
                        <strong>{metrics.firstAttemptDelivered.percent}%</strong>{" "}
                        <span className="text-muted-foreground">({formatNumber(metrics.firstAttemptDelivered.count)})</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, metrics.firstAttemptDelivered.percent)}%` }}
                      />
                    </div>
                  </div>

                  {/* Second Attempt */}
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-foreground flex items-center gap-2">
                        <span className="size-2 rounded-full bg-amber-500" />
                        2nd Attempt Delivery %
                      </span>
                      <span className="text-foreground">
                        <strong>{metrics.secondAttemptDelivered.percent}%</strong>{" "}
                        <span className="text-muted-foreground">
                          ({formatNumber(metrics.secondAttemptDelivered.count)})
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(3, metrics.secondAttemptDelivered.percent))}%` }}
                      />
                    </div>
                  </div>

                  {/* Third Attempt */}
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-foreground flex items-center gap-2">
                        <span className="size-2 rounded-full bg-orange-500" />
                        3rd Attempt Delivery %
                      </span>
                      <span className="text-foreground">
                        <strong>{metrics.thirdAttemptDelivered.percent}%</strong>{" "}
                        <span className="text-muted-foreground">({formatNumber(metrics.thirdAttemptDelivered.count)})</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-orange-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(2, metrics.thirdAttemptDelivered.percent))}%` }}
                      />
                    </div>
                  </div>

                  {/* Later Attempt */}
                  {metrics.laterAttemptDelivered.count > 0 && (
                    <div>
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="text-foreground flex items-center gap-2">
                          <span className="size-2 rounded-full bg-rose-500" />
                          4th+ Attempt Delivery %
                        </span>
                        <span className="text-foreground">
                          <strong>{metrics.laterAttemptDelivered.percent}%</strong>{" "}
                          <span className="text-muted-foreground">
                            ({formatNumber(metrics.laterAttemptDelivered.count)})
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-rose-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(2, metrics.laterAttemptDelivered.percent))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Based on recorded delivery attempts before status resolution</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {metrics.firstAttemptDelivered.percent}% delivered immediately
                  </span>
                </div>
              </article>

              {/* COD vs Prepaid Ratio & Delivery Rates */}
              <article className="rounded-xl border border-border bg-card p-5 shadow-xs">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Payment Method Split & Delivery %</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      COD vs Prepaid volume ratio and comparison of actual delivery success rates
                    </p>
                  </div>
                  <CreditCard size={17} className="text-muted-foreground" />
                </div>

                {/* Ratio bar */}
                <div className="mt-4">
                  <div className="flex justify-between text-xs font-semibold mb-1.5">
                    <span className="text-foreground flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-amber-500" />
                      COD: {metrics.codRatio}% ({formatNumber(metrics.cod.count)})
                    </span>
                    <span className="text-foreground flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-indigo-500" />
                      Prepaid: {metrics.prepaidRatio}% ({formatNumber(metrics.prepaid.count)})
                    </span>
                  </div>
                  <div className="h-3 w-full bg-muted rounded-full overflow-hidden flex">
                    <div className="h-full bg-amber-500" style={{ width: `${metrics.codRatio}%` }} />
                    <div className="h-full bg-indigo-500" style={{ width: `${metrics.prepaidRatio}%` }} />
                  </div>
                </div>

                {/* Delivery Comparison Cards */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/80 bg-muted/30 p-3">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      COD Delivery %
                    </span>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <strong className="text-xl font-bold text-foreground">{metrics.codDeliveryRate}%</strong>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatNumber(metrics.codDelivered)} delivered of {formatNumber(metrics.codShipped)} shipped
                    </p>
                    <div className="mt-2 pt-1.5 border-t border-border/60 text-[10px] text-muted-foreground flex justify-between">
                      <span>Closed rate:</span>
                      <strong className="text-foreground">{metrics.codClosedDeliveryRate}%</strong>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-muted/30 p-3">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Prepaid Delivery %
                    </span>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <strong className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                        {metrics.prepaidDeliveryRate}%
                      </strong>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatNumber(metrics.prepaidDelivered)} delivered of {formatNumber(metrics.prepaidShipped)} shipped
                    </p>
                    <div className="mt-2 pt-1.5 border-t border-border/60 text-[10px] text-muted-foreground flex justify-between">
                      <span>Closed rate:</span>
                      <strong className="text-foreground">{metrics.prepaidClosedDeliveryRate}%</strong>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Prepaid delivery rate is higher by</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    +{(metrics.prepaidDeliveryRate - metrics.codDeliveryRate).toFixed(1)}% vs COD
                  </span>
                </div>
              </article>
            </div>

            {/* DEEP-DIVE SUBSECTIONS (Couriers, Dates, States, NDR Reasons, Products) */}
            <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
              {/* Tab Navigation */}
              <div className="border-b border-border bg-muted/20 px-5 pt-3 flex flex-wrap items-center justify-between gap-4">
                <nav className="flex items-center gap-1 overflow-x-auto pb-px" aria-label="Analytics breakdowns">
                  {[
                    { id: "couriers", label: "Delivery % by courier", icon: Truck },
                    { id: "dates", label: "Date-Wise Trend %", icon: Calendar },
                    { id: "states", label: "State-Wise Delivery %", icon: MapPin },
                    { id: "ndr", label: "NDR Reasons", icon: AlertTriangle },
                    { id: "products", label: "Product-Wise Delivery %", icon: Layers },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(tab.id as typeof activeTab);
                          setSubSearch("");
                        }}
                        className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition ${
                          isActive
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                        }`}
                      >
                        <Icon size={14} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </nav>

                {/* Sub-search filter */}
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search in this view…"
                    value={subSearch}
                    onChange={(e) => setSubSearch(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-card pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-52"
                  />
                  {subSearch && (
                    <button
                      type="button"
                      onClick={() => setSubSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* 1. COURIER-WISE DELIVERY % */}
              {activeTab === "couriers" && (
                <div className="overflow-x-auto p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <h3 className="text-sm font-bold text-foreground">Delivery % by courier</h3>
                    <p className="text-xs text-muted-foreground">Delivered ÷ final outcomes; highest-volume couriers first</p>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                      <tr>
                        <th className="py-3 px-4">Courier Name</th>
                        <th className="py-3 px-4 text-right">Total Orders</th>
                        <th className="py-3 px-4 text-right">Shipped</th>
                        <th className="py-3 px-4 text-right">Delivered</th>
                        <th className="py-3 px-4 text-right">Delivery % (Shipped)</th>
                        <th className="py-3 px-4 text-right">Closed Del %</th>
                        <th className="py-3 px-4 text-right">RTO Count</th>
                        <th className="py-3 px-4 text-right">RTO %</th>
                        <th className="py-3 px-4 text-right">Avg TAT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredCouriers.map((c) => (
                        <tr key={c.name} className="hover:bg-muted/30 transition">
                          <td className="py-3 px-4 font-semibold text-foreground flex items-center gap-2">
                            <Truck size={14} className="text-muted-foreground" />
                            <span>{c.name}</span>
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground">{formatNumber(c.total)}</td>
                          <td className="py-3 px-4 text-right text-foreground font-medium">{formatNumber(c.shipped)}</td>
                          <td className="py-3 px-4 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                            {formatNumber(c.delivered)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                c.deliveryRate >= 70
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : c.deliveryRate >= 50
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "bg-destructive/10 text-destructive"
                              }`}
                            >
                              {c.deliveryRate}%
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground font-medium">
                            {c.closedDeliveryRate}%
                          </td>
                          <td className="py-3 px-4 text-right text-destructive">{formatNumber(c.rto)}</td>
                          <td className="py-3 px-4 text-right font-medium text-destructive">{c.rtoRate}%</td>
                          <td className="py-3 px-4 text-right text-foreground font-mono">
                            {c.avgTatDays != null ? `${c.avgTatDays} d` : "—"}
                          </td>
                        </tr>
                      ))}
                      {filteredCouriers.length === 0 && (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-xs text-muted-foreground">
                            No courier data found for the current search/filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 2. DATE-WISE TREND % */}
              {activeTab === "dates" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                      <tr>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4 text-right">Orders</th>
                        <th className="py-3 px-4 text-right">Shipped</th>
                        <th className="py-3 px-4 text-right">Delivered</th>
                        <th className="py-3 px-4 text-right">Delivery %</th>
                        <th className="py-3 px-4 text-right">RTO Count</th>
                        <th className="py-3 px-4 text-right">RTO %</th>
                        <th className="py-3 px-4 text-right">NDR</th>
                        <th className="py-3 px-4 text-right">In Transit</th>
                        <th className="py-3 px-4 text-right">OFD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredDates.map((d) => (
                        <tr key={d.date} className="hover:bg-muted/30 transition">
                          <td className="py-3 px-4 font-mono font-medium text-foreground">{formatDate(d.date)}</td>
                          <td className="py-3 px-4 text-right text-muted-foreground">{formatNumber(d.total)}</td>
                          <td className="py-3 px-4 text-right text-foreground font-medium">{formatNumber(d.shipped)}</td>
                          <td className="py-3 px-4 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                            {formatNumber(d.delivered)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                d.deliveryRate >= 70
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : d.deliveryRate >= 50
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "bg-destructive/10 text-destructive"
                              }`}
                            >
                              {d.deliveryRate}%
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-destructive">{formatNumber(d.rto)}</td>
                          <td className="py-3 px-4 text-right text-destructive font-medium">{d.rtoRate}%</td>
                          <td className="py-3 px-4 text-right text-amber-600 dark:text-amber-400">{formatNumber(d.ndr)}</td>
                          <td className="py-3 px-4 text-right text-indigo-600 dark:text-indigo-400 font-medium">
                            {formatNumber(d.inTransit)}
                          </td>
                          <td className="py-3 px-4 text-right text-sky-600 dark:text-sky-400 font-medium">
                            {formatNumber(d.outForDelivery)}
                          </td>
                        </tr>
                      ))}
                      {filteredDates.length === 0 && (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-xs text-muted-foreground">
                            No date rows found for the selected range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 3. STATE-WISE DELIVERY % */}
              {activeTab === "states" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                      <tr>
                        <th className="py-3 px-4">State</th>
                        <th className="py-3 px-4 text-right">Total Orders</th>
                        <th className="py-3 px-4 text-right">Shipped</th>
                        <th className="py-3 px-4 text-right">Delivered</th>
                        <th className="py-3 px-4 text-right">Delivery % (Shipped)</th>
                        <th className="py-3 px-4 text-right">Closed Delivery %</th>
                        <th className="py-3 px-4 text-right">RTO Count</th>
                        <th className="py-3 px-4 text-right">RTO %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredStates.map((s) => (
                        <tr key={s.state} className="hover:bg-muted/30 transition">
                          <td className="py-3 px-4 font-semibold text-foreground flex items-center gap-2">
                            <MapPin size={13} className="text-muted-foreground shrink-0" />
                            <span>{s.state}</span>
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground">{formatNumber(s.total)}</td>
                          <td className="py-3 px-4 text-right text-foreground font-medium">{formatNumber(s.shipped)}</td>
                          <td className="py-3 px-4 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                            {formatNumber(s.delivered)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                s.deliveryRate >= 70
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : s.deliveryRate >= 50
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "bg-destructive/10 text-destructive"
                              }`}
                            >
                              {s.deliveryRate}%
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground font-medium">
                            {s.closedDeliveryRate}%
                          </td>
                          <td className="py-3 px-4 text-right text-destructive">{formatNumber(s.rto)}</td>
                          <td className="py-3 px-4 text-right text-destructive font-medium">{s.rtoRate}%</td>
                        </tr>
                      ))}
                      {filteredStates.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                            No state data found matching your search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 4. NDR REASONS BREAKDOWN */}
              {activeTab === "ndr" && (
                <div className="p-5 space-y-4">
                  <div className="border-b border-border/60 pb-3">
                    <h3 className="text-sm font-bold text-foreground">Top Non-Delivery Reasons (NDR)</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Detailed causes recorded when delivery attempts encountered exceptions
                    </p>
                  </div>

                  <div className="space-y-3">
                    {filteredNdrReasons.map((item) => (
                      <div key={item.reason} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-foreground" title={item.reason}>
                            {item.reason}
                          </span>
                          <span className="text-muted-foreground">
                            <strong className="text-foreground">{formatNumber(item.count)}</strong> incidents (
                            {item.percent}% of NDRs)
                          </span>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, (item.count / maxNdrCount) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    {filteredNdrReasons.length === 0 && (
                      <div className="py-12 text-center text-xs text-muted-foreground">
                        No NDR reasons recorded for this cohort.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 5. PRODUCT-WISE DELIVERY % */}
              {activeTab === "products" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                      <tr>
                        <th className="py-3 px-4">Product Name</th>
                        <th className="py-3 px-4 text-right">Orders Containing</th>
                        <th className="py-3 px-4 text-right">Shipped</th>
                        <th className="py-3 px-4 text-right">Delivered</th>
                        <th className="py-3 px-4 text-right">Delivery % (Shipped)</th>
                        <th className="py-3 px-4 text-right">Closed Outcome %</th>
                        <th className="py-3 px-4 text-right">RTO Count</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredProducts.map((p) => (
                        <tr key={p.name} className="hover:bg-muted/30 transition">
                          <td className="py-3 px-4 font-semibold text-foreground max-w-sm truncate" title={p.name}>
                            {p.name}
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground font-mono">
                            {formatNumber(p.orderCount)}
                          </td>
                          <td className="py-3 px-4 text-right text-foreground font-medium">{formatNumber(p.shipped)}</td>
                          <td className="py-3 px-4 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                            {formatNumber(p.delivered)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                p.deliveryRate >= 70
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : p.deliveryRate >= 50
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "bg-destructive/10 text-destructive"
                              }`}
                            >
                              {p.deliveryRate}%
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground font-medium">
                            {p.closedDeliveryRate}%
                          </td>
                          <td className="py-3 px-4 text-right text-destructive font-medium">{formatNumber(p.rto)}</td>
                        </tr>
                      ))}
                      {filteredProducts.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                            No product data found matching search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
