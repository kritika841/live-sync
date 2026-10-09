"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Layers,
  MapPin,
  PackageCheck,
  Percent,
  RefreshCw,
  Search,
  ShieldCheck,
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
    closed: number;
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
  todayOfd?: {
    date: string;
    total: number;
    stillOut: number;
    delivered: number;
    undelivered: number;
    rto: number;
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
  customerPhone?: string;
  webhookCount?: number;
  eventsLog?: Array<{ status: string; eventAt: string; receivedAt: string; source: string }>;
  verifiedStatus?: "pending" | "verified" | "discrepant";
  notes?: string;
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

function addDaysToIso(isoDateStr: string, days: number): string {
  const [y, m, d] = isoDateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const PARAMETER_STATUSES = {
  DELIVERED: [
    "DELIVERED",
    "DELIVERED TO CUSTOMER",
    "DELIVERY ACKNOWLEDGED",
  ],
  IN_TRANSIT: [
    "SHIPPED",
    "IN TRANSIT",
    "IN TRANSIT-EN-ROUTE",
    "IN TRANSIT-AT DESTINATION HUB",
    "REACHED AT DESTINATION HUB",
    "REACHED DESTINATION HUB",
    "PICKED UP",
    "MISROUTED",
    "UNTRACEABLE",
  ],
  OUT_FOR_DELIVERY: [
    "OUT FOR DELIVERY",
  ],
  NDR: [
    "UNDELIVERED",
    "UNDELIVERED-1ST ATTEMPT",
    "UNDELIVERED-2ND ATTEMPT",
    "UNDELIVERED-3RD ATTEMPT",
    "Undelivered - Attempt Failure",
    "NDR",
    "NDR PENDING",
    "CUSTOMER UNREACHABLE",
    "ADDRESS INCOMPLETE",
  ],
  RTO: [
    "RTO INITIATED",
    "RTO IN TRANSIT",
    "RTO AT DESTINATION HUB",
    "RTO DELIVERED",
    "RTO NDR",
    "RTO OFD",
    "RTO ACKNOWLEDGED",
    "RETURN TO ORIGIN",
  ],
  LOST: [
    "LOST",
    "DAMAGED",
  ],
  NON_SHIPPED: [
    "NEW",
    "NEW ORDER",
    "CONFIRMED",
    "PROCESSING",
    "READY TO SHIP",
    "AWB ASSIGNED",
    "PICKUP SCHEDULED",
    "OUT FOR PICKUP",
    "INVOICED",
    "PICKUP ERROR",
    "PICKUP EXCEPTION",
    "SELF FULFILED",
    "SELF FULFILLED",
  ],
  CANCELLED: [
    "CANCELED",
    "CANCELLED",
    "ORDER CANCELED",
    "ORDER CANCELLED",
  ],
};

const ALL_SHIPPED_STATUSES = [
  ...PARAMETER_STATUSES.DELIVERED,
  ...PARAMETER_STATUSES.OUT_FOR_DELIVERY,
  ...PARAMETER_STATUSES.IN_TRANSIT,
  ...PARAMETER_STATUSES.NDR,
  ...PARAMETER_STATUSES.RTO,
  ...PARAMETER_STATUSES.LOST,
];

const CLOSED_STATUSES = [
  ...PARAMETER_STATUSES.DELIVERED,
  ...PARAMETER_STATUSES.RTO,
  ...PARAMETER_STATUSES.NDR,
];

const COHORT_ALL_STATUSES = [
  ...ALL_SHIPPED_STATUSES,
  ...PARAMETER_STATUSES.NON_SHIPPED,
  ...PARAMETER_STATUSES.CANCELLED,
];

function MetricInfoButton({
  title,
  formula,
  calculation,
  explanation,
  notes,
  align = "right",
  includedStatuses,
}: {
  title: string;
  formula: string;
  calculation?: string;
  explanation: string;
  notes?: string;
  align?: "left" | "right";
  includedStatuses?: string[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label={`Formula details for ${title}`}
        title={`View formula and included statuses for ${title}`}
        className={`inline-flex items-center justify-center size-5 rounded-full border transition-all ${
          open
            ? "border-primary bg-primary text-primary-foreground shadow-xs scale-105"
            : "border-border/80 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5"
        }`}
      >
        <span className="text-[11px] font-bold font-serif leading-none italic select-none">i</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={title}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={`absolute ${
            align === "left" ? "left-0" : "right-0"
          } top-7 z-50 w-72 sm:w-84 max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card/98 backdrop-blur-md p-3.5 shadow-2xl ring-1 ring-black/10 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-150 text-left`}
        >
          <div className="flex items-center justify-between pb-2 border-b border-border/60">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold font-serif italic">
                i
              </span>
              {title}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded transition"
              aria-label="Close formula details"
            >
              <X size={13} />
            </button>
          </div>

          <div className="mt-2.5 space-y-2.5">
            <div>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Formula
              </span>
              <div className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] text-foreground font-semibold border border-border/70 select-all break-words">
                {formula}
              </div>
            </div>

            {calculation && (
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                  Active Numbers
                </span>
                <div className="rounded-md bg-emerald-500/10 dark:bg-emerald-950/30 px-2.5 py-1.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-500/20 break-words">
                  {calculation}
                </div>
              </div>
            )}

            {includedStatuses && includedStatuses.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Included Statuses ({includedStatuses.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto p-1.5 rounded-lg bg-muted/60 border border-border/60">
                  {includedStatuses.map((st) => (
                    <span
                      key={st}
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-card text-foreground border border-border/80 shadow-2xs"
                    >
                      {st}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Definition
              </span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {explanation}
              </p>
            </div>

            {notes && (
              <div className="pt-2 border-t border-border/50 text-[10px] text-muted-foreground/90 italic leading-snug">
                {notes}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPanel({ active, mode = "overview", preview = false }: AnalyticsPanelProps) {
  const [activeMode, setActiveMode] = useState<"overview" | "today_ofd">(mode);

  useEffect(() => {
    if (mode) setActiveMode(mode);
  }, [mode]);

  const todayStr = useMemo(() => getTodayString(), []);
  const yesterdayStr = useMemo(() => addDaysToIso(getTodayString(), -1), []);
  const [datePreset, setDatePreset] = useState<
    "today" | "yesterday" | "7d" | "14d" | "30d" | "mtd" | "last_month" | "all" | "custom"
  >("yesterday");
  const [from, setFrom] = useState(() => yesterdayStr);
  const [to, setTo] = useState(() => yesterdayStr);

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
  const [ofdSearch, setOfdSearch] = useState("");
  const [selectedOrderEvents, setSelectedOrderEvents] = useState<OfdOrder | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  const sheetsOrigin = typeof window !== "undefined" ? window.location.origin : "https://satmi.in";
  const googleSheetsFormula = `=IMPORTDATA("${sheetsOrigin}/api/export/today-ofd?format=csv&date=${ofdDate}")`;

  function handleCopyFormula() {
    navigator.clipboard.writeText(googleSheetsFormula).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    });
  }

  async function handleVerify(orderId: number, status: "verified" | "discrepant") {
    setVerifyingId(orderId);
    try {
      await fetch("/api/analytics/today-ofd/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, date: ofdDate, verifiedStatus: status }),
      });
      setOfdData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId ? { ...o, verifiedStatus: status } : o
          ),
        };
      });
    } catch {
      // ignore
    } finally {
      setVerifyingId(null);
    }
  }

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
  const applyPreset = (preset: "today" | "yesterday" | "7d" | "14d" | "30d" | "mtd" | "last_month" | "all" | "custom") => {
    setDatePreset(preset);
    if (preset === "today") {
      setFrom(todayStr);
      setTo(todayStr);
    } else if (preset === "yesterday") {
      const yesterday = addDaysToIso(todayStr, -1);
      setFrom(yesterday);
      setTo(yesterday);
    } else if (preset === "7d") {
      setFrom(addDaysToIso(todayStr, -6));
      setTo(todayStr);
    } else if (preset === "14d") {
      setFrom(addDaysToIso(todayStr, -13));
      setTo(todayStr);
    } else if (preset === "30d") {
      setFrom(addDaysToIso(todayStr, -29));
      setTo(todayStr);
    } else if (preset === "mtd") {
      const startOfMonth = `${todayStr.slice(0, 7)}-01`;
      setFrom(startOfMonth);
      setTo(todayStr);
    } else if (preset === "last_month") {
      const currentYear = Number(todayStr.slice(0, 4));
      const currentMonth = Number(todayStr.slice(5, 7));
      const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
      const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const prevMonthStr = String(prevMonth).padStart(2, "0");
      const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
      setFrom(`${prevYear}-${prevMonthStr}-01`);
      setTo(`${prevYear}-${prevMonthStr}-${String(lastDay).padStart(2, "0")}`);
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

  const currentQueryRef = useRef(queryParams);
  useEffect(() => {
    currentQueryRef.current = queryParams;
  }, [queryParams]);

  const activeAbortControllerRef = useRef<AbortController | null>(null);

  async function fetchAnalytics(refresh = false) {
    if (preview) return;

    // Cancel any previous in-flight request to prevent race conditions
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    const requestQuery = queryParams;

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/analytics?${requestQuery}${refresh ? "&refresh=1" : ""}`, {
        cache: "no-store",
        headers: { "x-requested-with": "satmi-analytics" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to load analytics data");
      }
      const json = (await res.json()) as AnalyticsData;

      // Discard stale response if a newer request was initiated
      if (activeAbortControllerRef.current !== controller) return;

      setData(json);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (activeAbortControllerRef.current !== controller) return;
      setError(err instanceof Error ? err.message : "Error loading analytics");
    } finally {
      if (activeAbortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!active || activeMode !== "overview") return;

    // Debounce custom date picker selections by 200ms so user can set both From and To dates without firing intermediate multi-month queries
    const timer = setTimeout(() => {
      void fetchAnalytics();
    }, datePreset === "custom" ? 200 : 0);

    return () => {
      clearTimeout(timer);
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeMode, queryParams]);

  const metrics = data?.metrics;

  const courierWise = data?.courierWise;
  const stateWise = data?.stateWise;
  const productWise = data?.productWise;
  const dateWise = data?.dateWise;
  const ndrReasons = data?.ndrReasons;

  // Filtered lists for sub-tables
  const filteredCouriers = useMemo(() => {
    if (!courierWise) return [];
    if (!subSearch.trim()) return courierWise;
    const term = subSearch.toLowerCase();
    return courierWise.filter((c) => c.name.toLowerCase().includes(term));
  }, [courierWise, subSearch]);

  const filteredStates = useMemo(() => {
    if (!stateWise) return [];
    if (!subSearch.trim()) return stateWise;
    const term = subSearch.toLowerCase();
    return stateWise.filter((s) => s.state.toLowerCase().includes(term));
  }, [stateWise, subSearch]);

  const filteredProducts = useMemo(() => {
    if (!productWise) return [];
    if (!subSearch.trim()) return productWise;
    const term = subSearch.toLowerCase();
    return productWise.filter((p) => p.name.toLowerCase().includes(term));
  }, [productWise, subSearch]);

  const filteredDates = useMemo(() => {
    if (!dateWise) return [];
    if (!subSearch.trim()) return dateWise;
    const term = subSearch.toLowerCase();
    return dateWise.filter((d) => d.date.includes(term));
  }, [dateWise, subSearch]);

  const filteredNdrReasons = useMemo(() => {
    if (!ndrReasons) return [];
    if (!subSearch.trim()) return ndrReasons;
    const term = subSearch.toLowerCase();
    return ndrReasons.filter((r) => r.reason.toLowerCase().includes(term));
  }, [ndrReasons, subSearch]);

  const maxNdrCount = useMemo(() => {
    if (!ndrReasons || ndrReasons.length === 0) return 1;
    return Math.max(...ndrReasons.map((r) => r.count), 1);
  }, [ndrReasons]);

  if (activeMode === "today_ofd") {
    const ofdMetrics = ofdData?.metrics || {};
    const historical = ofdDate < todayStr;
    const shownOrders = (ofdData?.orders || []).filter((order) => {
      if (ofdOutcome === "delivered" && !/^(DELIVERED|DELIVERED TO CUSTOMER)$/i.test(order.status)) return false;
      if (ofdOutcome === "undelivered" && !/UNDELIVERED|NDR|RTO|RETURN TO ORIGIN/i.test(order.status)) return false;
      if (ofdOutcome === "out" && !/^OUT FOR DELIVERY$/i.test(order.status)) return false;
      if (ofdOutcome === "unresolved" && !/^UNRESOLVED AFTER OFD$/i.test(order.status)) return false;
      if (ofdOutcome.startsWith("attempt") && order.attemptNumber !== Number(ofdOutcome.slice(-1))) return false;
      if (ofdSearch.trim()) {
        const q = ofdSearch.toLowerCase();
        const matches =
          String(order.channelOrderId || "").toLowerCase().includes(q) ||
          String(order.id).includes(q) ||
          String(order.customerName || "").toLowerCase().includes(q) ||
          String(order.customerPhone || "").includes(q) ||
          String(order.awb || "").toLowerCase().includes(q) ||
          String(order.courier || "").toLowerCase().includes(q) ||
          String(order.customerCity || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
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

              {/* Google Sheets Live Formula Button */}
              <button
                type="button"
                onClick={handleCopyFormula}
                className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition shadow-xs"
                title="Copy live auto-sync formula for Google Sheets"
              >
                {copySuccess ? <Check size={14} className="text-emerald-600" /> : <FileSpreadsheet size={14} />}
                <span>{copySuccess ? "Formula Copied!" : "Auto-Sync to Google Sheet"}</span>
              </button>

              {/* One-Click Download CSV */}
              <a
                href={`/api/export/today-ofd?format=csv&date=${ofdDate}`}
                download={`satmi-today-ofd-${ofdDate}.csv`}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition shadow-xs"
                title="Download today's OFD CSV"
              >
                <Download size={14} className="text-muted-foreground" />
                <span>Export CSV</span>
              </a>

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

            <div className="text-xs text-muted-foreground flex items-center gap-3">
              {historical ? (
                <span className="text-amber-600 dark:text-amber-400 font-medium">Historical OFD archive</span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live today scans & webhooks
                </span>
              )}
            </div>
          </div>

          {/* GOOGLE SHEETS LIVE AUTO-SYNC BANNER */}
          <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 max-w-3xl">
              <div className="size-10 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5 shadow-xs">
                <FileSpreadsheet size={20} />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-xs font-bold text-foreground">Automated Google Sheets Live Sync</h4>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Auto-Refreshes On Its Own
                  </span>
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <ShieldCheck size={13} className="text-emerald-500" />
                    EOD Snapshot Auto-Saved to Disk
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Paste this formula in cell <strong>A1</strong> of your Google Sheet. It will automatically load all OFD orders and keep all delivery statuses updated throughout the day without manual downloads:
                </p>
                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <div className="flex items-center bg-card border border-border rounded-lg px-3 py-1.5 max-w-lg min-w-[280px] shadow-xs">
                    <code className="text-[11px] font-mono text-primary select-all truncate">
                      {googleSheetsFormula}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyFormula}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition shadow-xs cursor-pointer active:scale-95"
                  >
                    {copySuccess ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copySuccess ? "Copied Formula!" : "Copy Formula for Sheet"}</span>
                  </button>
                  <a
                    href={`/api/export/today-ofd?format=csv&date=${ofdDate}`}
                    download={`satmi-today-ofd-${ofdDate}.csv`}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground underline px-1 flex items-center gap-1"
                  >
                    Direct CSV link <ExternalLink size={11} />
                  </a>
                </div>
              </div>
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

                {/* Outcome filter tabs & Search */}
                <div className="border-b border-border px-5 py-2.5 bg-muted/10 flex flex-wrap items-center justify-between gap-3">
                  <nav className="outcome-tabs flex flex-wrap gap-1.5" aria-label="Filter OFD outcomes">
                    {(
                      [
                        ["all", `All (${ofdMetrics.total?.count || 0})`],
                        ["delivered", `Delivered (${ofdMetrics.delivered?.count || 0})`],
                        ["undelivered", `Undelivered / RTO (${(ofdMetrics.undelivered?.count || 0) + (ofdMetrics.rto?.count || 0)})`],
                        ["out", `Still OFD (${ofdMetrics.stillOut?.count || 0})`],
                        ["attempt1", `1st Attempt (${ofdMetrics.firstAttemptOFD?.count || 0})`],
                        ["attempt2", `2nd Attempt (${ofdMetrics.secondAttemptOFD?.count || 0})`],
                        ["attempt3", `3rd Attempt (${ofdMetrics.thirdAttemptOFD?.count || 0})`],
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

                  <div className="relative min-w-[200px] max-w-xs flex-1">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={ofdSearch}
                      onChange={(e) => setOfdSearch(e.target.value)}
                      placeholder="Search order, customer, AWB..."
                      className="w-full bg-card border border-border rounded-lg pl-8 pr-3 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {ofdSearch && (
                      <button
                        type="button"
                        onClick={() => setOfdSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                      <tr>
                        <th className="py-3 px-4">Order</th>
                        <th className="py-3 px-4">Attempt</th>
                        <th className="py-3 px-4">Customer</th>
                        <th className="py-3 px-4">OFD Time</th>
                        <th className="py-3 px-4">Outcome & Status</th>
                        <th className="py-3 px-4">AWB / Courier</th>
                        <th className="py-3 px-4">Amount</th>
                        <th className="py-3 px-4">Webhooks</th>
                        <th className="py-3 px-4 text-center">Manual Audit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {shownOrders.map((order) => {
                        const isDelivered = /^(DELIVERED|DELIVERED TO CUSTOMER)$/i.test(order.status);
                        const isUndelivered = /UNDELIVERED|NDR/i.test(order.status);
                        const isRto = /RTO/i.test(order.status);
                        const isStillOut = /^OUT FOR DELIVERY$/i.test(order.status);

                        return (
                          <tr key={order.id} className="hover:bg-muted/30 transition">
                            <td className="py-3 px-4">
                              <strong className="text-foreground">#{order.channelOrderId || order.id}</strong>
                              {order.previousUndelivered && (
                                <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                  Prior failed attempt
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-muted text-foreground">
                                Attempt {order.attemptNumber || 1}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <strong className="text-foreground">{order.customerName || "—"}</strong>
                              <span className="block text-[10px] text-muted-foreground">
                                {[order.customerCity, order.customerState].filter(Boolean).join(", ")}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-muted-foreground">
                              <span>{formatDateTime(order.outForDeliveryAt)}</span>
                              {order.firstOutForDeliveryAt && order.firstOutForDeliveryAt !== order.outForDeliveryAt && (
                                <span className="block text-[10px] text-muted-foreground/80">
                                  1st: {formatDateTime(order.firstOutForDeliveryAt)}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              {isDelivered && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                  <Check size={12} /> Delivered
                                </span>
                              )}
                              {isStillOut && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-sky-500/15 text-sky-600 dark:text-sky-400">
                                  <Truck size={12} /> Still OFD
                                </span>
                              )}
                              {isUndelivered && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-destructive/15 text-destructive">
                                  <AlertTriangle size={12} /> Undelivered
                                </span>
                              )}
                              {isRto && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400">
                                  <TrendingDown size={12} /> RTO
                                </span>
                              )}
                              {!isDelivered && !isStillOut && !isUndelivered && !isRto && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-muted text-foreground">
                                  {order.status || "Unknown"}
                                </span>
                              )}

                              {order.deliveredAt && (
                                <span className="block text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                                  {formatDateTime(order.deliveredAt)}
                                </span>
                              )}
                              {order.ndrReason && (
                                <span className="block text-[10px] text-destructive mt-0.5">
                                  {order.ndrReason}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <strong className="text-foreground">{order.awb || "—"}</strong>
                              <span className="block text-[10px] text-muted-foreground">
                                {order.courier || "Not assigned"}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-semibold text-foreground">
                              <span>{formatCurrency(order.total)}</span>
                              <span className="block text-[10px] text-muted-foreground uppercase font-normal">
                                {order.paymentMethod || "COD"}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <button
                                type="button"
                                onClick={() => setSelectedOrderEvents(order)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded transition"
                                title="Inspect webhook events for this order"
                              >
                                <span>{order.webhookCount || 0} events</span>
                              </button>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {order.verifiedStatus === "verified" ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 px-2.5 py-1 rounded-md">
                                  <Check size={12} /> Verified
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleVerify(order.id, "verified")}
                                  disabled={verifyingId === order.id}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-emerald-600 border border-border hover:border-emerald-500/40 bg-card hover:bg-emerald-500/10 px-2.5 py-1 rounded-md transition shadow-xs disabled:opacity-50"
                                >
                                  <Check size={12} />
                                  <span>Verify</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {shownOrders.length === 0 && (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-xs text-muted-foreground">
                            No orders went out for delivery matching this filter on this date.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* WEBHOOK EVENTS TIMELINE MODAL */}
              {selectedOrderEvents && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
                  <div className="bg-card border border-border rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20">
                      <div>
                        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                          <span>Webhook Stream — #{selectedOrderEvents.channelOrderId || selectedOrderEvents.id}</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                            {selectedOrderEvents.status}
                          </span>
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {selectedOrderEvents.customerName} • {selectedOrderEvents.courier} ({selectedOrderEvents.awb})
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedOrderEvents(null)}
                        className="size-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="p-5 overflow-y-auto space-y-4 text-xs">
                      <div>
                        <h4 className="font-bold text-foreground mb-2 text-xs uppercase tracking-wider">OFD & Status Scans</h4>
                        <div className="space-y-2 bg-muted/20 border border-border rounded-lg p-3">
                          <div className="flex justify-between py-1 border-b border-border/50">
                            <span className="text-muted-foreground">Initial OFD Time:</span>
                            <span className="font-semibold text-foreground">{formatDateTime(selectedOrderEvents.firstOutForDeliveryAt || selectedOrderEvents.outForDeliveryAt)}</span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-border/50">
                            <span className="text-muted-foreground">Latest OFD Time:</span>
                            <span className="font-semibold text-foreground">{formatDateTime(selectedOrderEvents.outForDeliveryAt)}</span>
                          </div>
                          {selectedOrderEvents.deliveredAt && (
                            <div className="flex justify-between py-1 border-b border-border/50 text-emerald-600 dark:text-emerald-400">
                              <span className="font-medium">Delivered Timestamp:</span>
                              <span className="font-bold">{formatDateTime(selectedOrderEvents.deliveredAt)}</span>
                            </div>
                          )}
                          {selectedOrderEvents.ndrReason && (
                            <div className="flex justify-between py-1 text-destructive">
                              <span className="font-medium">NDR Reason:</span>
                              <span className="font-bold">{selectedOrderEvents.ndrReason}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-bold text-foreground mb-2 text-xs uppercase tracking-wider">
                          Live Webhook Ingestion Events ({selectedOrderEvents.eventsLog?.length || 0})
                        </h4>
                        {selectedOrderEvents.eventsLog && selectedOrderEvents.eventsLog.length > 0 ? (
                          <div className="space-y-2">
                            {selectedOrderEvents.eventsLog.map((ev, idx) => (
                              <div key={idx} className="p-2.5 rounded-lg border border-border bg-card flex items-start justify-between gap-3">
                                <div>
                                  <span className="font-bold text-foreground text-xs">{ev.status}</span>
                                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                                    Source: {ev.source || "webhook"}
                                  </span>
                                </div>
                                <span className="text-[11px] text-muted-foreground font-mono">
                                  {formatDateTime(ev.eventAt || ev.receivedAt)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 rounded-lg bg-muted/20 border border-dashed border-border text-center text-muted-foreground">
                            <p>No individual webhook events logged for this order today yet.</p>
                            <p className="text-[11px] mt-1 text-muted-foreground/80">Status was captured via real-time Shiprocket sync.</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-4 border-t border-border flex justify-end bg-muted/20">
                      <button
                        type="button"
                        onClick={() => setSelectedOrderEvents(null)}
                        className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 transition shadow-xs"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
                { id: "last_month", label: "Last Month" },
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
                max={todayStr}
                onChange={(e) => {
                  const val = e.target.value;
                  setFrom(val);
                  setDatePreset("custom");
                  if (to && val && val > to) {
                    setTo(val);
                  }
                }}
                className="bg-transparent border-0 text-foreground text-xs p-0 focus:outline-none cursor-pointer"
                title="Start Date"
              />
              <span className="text-muted-foreground/60">—</span>
              <input
                type="date"
                value={to}
                max={todayStr}
                onChange={(e) => {
                  const val = e.target.value;
                  setTo(val);
                  setDatePreset("custom");
                  if (from && val && val < from) {
                    setFrom(val);
                  }
                }}
                className="bg-transparent border-0 text-foreground text-xs p-0 focus:outline-none cursor-pointer"
                title="End Date"
              />
            </div>

            {/* Historical Month Selector */}
            <select
              value={
                from && to && from.slice(0, 7) === to.slice(0, 7) && from.slice(8, 10) === "01"
                  ? from.slice(0, 7)
                  : ""
              }
              onChange={(e) => {
                const ym = e.target.value;
                if (!ym) return;
                const [year, month] = ym.split("-").map(Number);
                const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
                const newFrom = `${ym}-01`;
                const newTo = ym === todayStr.slice(0, 7) ? todayStr : `${ym}-${String(lastDay).padStart(2, "0")}`;
                setFrom(newFrom);
                setTo(newTo);
                setDatePreset("custom");
              }}
              className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted/50 transition focus:outline-none shadow-xs"
              title="Select Specific Month"
            >
              <option value="">Month…</option>
              <option value="2026-09">September 2026</option>
              <option value="2026-08">August 2026</option>
              <option value="2026-07">July 2026</option>
              <option value="2026-06">June 2026</option>
              <option value="2026-05">May 2026</option>
              <option value="2026-04">April 2026</option>
              <option value="2026-03">March 2026</option>
              <option value="2026-02">February 2026</option>
              <option value="2026-01">January 2026</option>
            </select>

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
      <div className="p-5 space-y-6 relative">
        {loading && data && (
          <div className="sticky top-20 z-30 flex items-center justify-center pointer-events-none mb-[-48px]">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-primary/30 bg-card/95 px-4 py-2 text-xs font-semibold text-foreground shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 pointer-events-auto">
              <RefreshCw size={15} className="animate-spin text-primary" />
              <span>Fetching fresh analytics data…</span>
            </div>
          </div>
        )}

        {loading && !data && (
          <div className="py-24 text-center space-y-3">
            <RefreshCw size={28} className="animate-spin text-primary mx-auto" />
            <p className="text-xs font-medium text-muted-foreground">Calculating high-precision delivery analytics…</p>
          </div>
        )}

        {data && metrics && (
          <div className={`space-y-6 transition-all duration-200 ${loading ? "filter blur-[2px] opacity-60 pointer-events-none select-none" : ""}`}>
            {/* PRIMARY HEADLINE KPI CARDS */}
            {/* PRIMARY HEADLINE KPI CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {/* 1. Total Shipped Orders */}
              <article className="rounded-xl border border-border bg-card p-4 shadow-xs relative group hover:border-primary/50 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">
                      Fulfillment
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">Total Shipped Orders</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="Total Shipped Orders"
                      formula="Delivered + RTO + NDR/Undelivered + In Transit + OFD + Lost"
                      includedStatuses={ALL_SHIPPED_STATUSES}
                      calculation={`${formatNumber(metrics.shipped.count)} shipped out of ${formatNumber(metrics.total.count)} total orders (${metrics.shipped.percent}%)`}
                      explanation="Total orders physically manifested, dispatched, and handed over to courier carriers across active transit and finalized statuses. Fresh unfulfilled orders awaiting warehouse pick-pack are excluded."
                      notes="Forms the population base for Open Delivery % and RTO %."
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Truck size={18} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">
                    {formatNumber(metrics.shipped.count)}
                  </strong>
                  <span className="text-xs font-semibold text-primary flex items-center">
                    {metrics.shipped.percent}% cohort
                  </span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Delivered: <strong className="text-foreground">{formatNumber(metrics.delivered.count)}</strong>
                  </span>
                  <span>
                    RTO: <strong className="text-foreground">{formatNumber(metrics.rto.count)}</strong>
                  </span>
                  <span>
                    En Route: <strong className="text-foreground">{formatNumber(metrics.inTransit.count + metrics.outForDelivery.count + metrics.ndr.count)}</strong>
                  </span>
                </div>
              </article>

              {/* 2. Total Delivered Orders */}
              <article className="rounded-xl border border-border bg-card p-4 shadow-xs relative group hover:border-emerald-500/50 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                      Completed
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">Total Delivered Orders</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="Total Delivered Orders"
                      formula="Orders confirmed DELIVERED to customer"
                      includedStatuses={PARAMETER_STATUSES.DELIVERED}
                      calculation={`${formatNumber(metrics.delivered.count)} delivered (${metrics.openOrdersDeliveryRate}% of shipped, ${metrics.deliveryRate}% of cohort)`}
                      explanation="Total shipments successfully delivered to end customers with verified courier delivery scan confirmation. Total store-to-door delivery success."
                      notes={`Delivered revenue: ${formatCurrency(data.financials.deliveredRevenue)}. Average delivered order value: ${formatCurrency(data.financials.avgDeliveredOrderValue)}.`}
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                      <CheckCircle2 size={18} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                    {formatNumber(metrics.delivered.count)}
                  </strong>
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center" title={`${metrics.openOrdersDeliveryRate}% of shipped (${formatNumber(metrics.delivered.count)} / ${formatNumber(metrics.shipped.count)}), ${metrics.deliveryRate}% of cohort`}>
                    <ArrowUpRight size={14} /> {metrics.openOrdersDeliveryRate}% <span className="text-[10px] font-normal text-muted-foreground ml-1">of shipped</span>
                  </span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    1st Attempt: <strong className="text-foreground">{metrics.firstAttemptDelivered.percent}%</strong>
                  </span>
                  <span>
                    Revenue: <strong className="text-foreground">{formatCurrency(data.financials.deliveredRevenue)}</strong>
                  </span>
                </div>
              </article>

              {/* 3. Open Orders Delivery % */}
              <article className="rounded-xl border border-border bg-card p-4 shadow-xs relative group hover:border-primary/50 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">
                      Primary Rate
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">Open Orders Delivery %</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="Open Orders Delivery %"
                      formula="Delivered ÷ Total Shipped (Date Range) × 100"
                      includedStatuses={ALL_SHIPPED_STATUSES}
                      calculation={`${formatNumber(metrics.delivered.count)} ÷ ${formatNumber(metrics.shipped.count)} × 100 = ${metrics.openOrdersDeliveryRate}%`}
                      explanation="Calculates delivery success across all packages handed over to couriers in the date range. Numerator is Delivered; denominator includes all active transit and finalized statuses (Delivered + In Transit + OFD + NDR + RTO). Delivery success across all dispatched shipments."
                      notes="Fresh store orders placed today that are awaiting warehouse dispatch are excluded from shipped."
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <TrendingUp size={18} />
                    </div>
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
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Delivered: <strong className="text-foreground">{formatNumber(metrics.delivered.count)}</strong>
                  </span>
                  <span>
                    Shipped: <strong className="text-foreground">{formatNumber(metrics.shipped.count)}</strong>
                  </span>
                </div>
              </article>

              {/* 4. Closed Orders Delivery % */}
              <article className="rounded-xl border border-border bg-card p-4 shadow-xs relative group hover:border-border/80 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider">
                      Attempted Rate
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">Closed Orders Delivery %</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="Closed Orders Delivery %"
                      formula="Delivered ÷ (Delivered + RTO + Undelivered) × 100"
                      includedStatuses={CLOSED_STATUSES}
                      calculation={`${formatNumber(metrics.delivered.count)} ÷ (${formatNumber(metrics.delivered.count)} + ${formatNumber(metrics.rto.count)} + ${formatNumber(metrics.ndr.count)}) × 100 = ${metrics.closedOrdersDeliveryRate}%`}
                      explanation="Measures delivery conversion strictly on resolved and attempted shipments (Delivered ÷ [Delivered + RTO + Undelivered] × 100). Conversion rate on resolved & attempted shipments. Line-haul packages still travelling between hubs with 0 attempts are excluded so newer cohorts aren't penalized."
                      notes={`Outcomes (${formatNumber(metrics.closed.count)}) = Delivered (${formatNumber(metrics.delivered.count)}) + RTO (${formatNumber(metrics.rto.count)}) + Open NDR (${formatNumber(metrics.ndr.count)}).`}
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
                      <PackageCheck size={18} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">
                    {metrics.closedOrdersDeliveryRate}%
                  </strong>
                  <span className="text-xs text-muted-foreground">conversion</span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Outcomes: <strong className="text-foreground">{formatNumber(metrics.closed.count)}</strong>
                  </span>
                  <span>
                    RTO ({formatNumber(metrics.rto.count)}) + Open NDR ({formatNumber(metrics.ndr.count)})
                  </span>
                </div>
              </article>

              {/* 5. RTO % */}
              <article className="rounded-xl border border-destructive/20 bg-card p-4 shadow-xs relative group hover:border-destructive/40 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive uppercase tracking-wider">
                      Return Rate
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">RTO % (Return to Origin)</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="RTO % (Return to Origin)"
                      formula="RTO ÷ Total Shipped × 100"
                      includedStatuses={PARAMETER_STATUSES.RTO}
                      calculation={`${formatNumber(metrics.rto.count)} ÷ ${formatNumber(metrics.shipped.count)} × 100 = ${metrics.rtoRate}%`}
                      explanation="The percentage of dispatched orders that could not be delivered and are marked for return to origin warehouse. Returned shipments out of total dispatched orders."
                      notes={`Total RTO share across all orders: ${metrics.rtoOfTotal.percent}%.`}
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                      <TrendingDown size={18} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-destructive">{metrics.rtoRate}%</strong>
                  <span className="text-xs text-destructive font-medium flex items-center">
                    <ArrowDownRight size={14} /> of shipped
                  </span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    RTO Count: <strong className="text-destructive">{formatNumber(metrics.rto.count)}</strong>
                  </span>
                  <span>
                    Total %: <strong className="text-foreground">{metrics.rtoOfTotal.percent}%</strong>
                  </span>
                </div>
              </article>

              {/* 6. Overall Delivery % */}
              <article className="rounded-xl border border-border bg-card p-4 shadow-xs relative group hover:border-border/80 transition">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                      Cohort Total
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-2">Overall Delivered %</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="Overall Delivered %"
                      formula="Delivered ÷ Total Cohort Orders × 100"
                      includedStatuses={COHORT_ALL_STATUSES}
                      calculation={`${formatNumber(metrics.delivered.count)} ÷ ${formatNumber(metrics.total.count)} × 100 = ${metrics.deliveryRate}%`}
                      explanation="Calculates delivered packages as a percentage of all orders placed in this time window, including unfulfilled, cancelled, or pending orders. Store-wide delivery rate across all orders placed."
                      notes="Shows true store-to-door completion across the cohort."
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                      <CheckCircle2 size={18} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">
                    {metrics.deliveryRate}%
                  </strong>
                  <span className="text-xs text-muted-foreground">of all orders</span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Total: <strong className="text-foreground">{formatNumber(metrics.total.count)}</strong>
                  </span>
                  <span>
                    Delivered: <strong className="text-foreground">{formatNumber(metrics.delivered.count)}</strong>
                  </span>
                </div>
              </article>
            </div>

            {/* SECONDARY PARAMETERS GRID: In Transit, OFD, NDR Recovery, Avg TAT */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* In Transit (0 Attempts) */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-xs relative">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                      Line-Haul
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-1.5">In Transit (0 Attempts)</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="In Transit Shipments (0 Attempts)"
                      formula="In Transit Orders (0 Delivery Attempts) ÷ Total Shipped × 100"
                      includedStatuses={PARAMETER_STATUSES.IN_TRANSIT}
                      calculation={`${formatNumber(metrics.inTransit.count)} ÷ ${formatNumber(metrics.shipped.count)} × 100 = ${metrics.inTransit.percent}%`}
                      explanation="Line-haul packages currently en route between fulfillment hubs and destination centers with zero delivery attempts. Once a courier rider attempts delivery, the parcel enters Out for Delivery or NDR."
                      notes={`Strict 0-attempt shipments: ${formatNumber(metrics.inTransitZeroAttempts.count)} of ${formatNumber(metrics.inTransit.count)} in-transit orders.`}
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
                      <Truck size={18} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">{metrics.inTransit.percent}%</strong>
                  <span className="text-xs text-muted-foreground">({formatNumber(metrics.inTransit.count)} orders)</span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Zero Attempts: <strong className="text-foreground">{formatNumber(metrics.inTransitZeroAttempts.count)}</strong>
                  </span>
                  <span>
                    Status: <strong className="text-foreground">In Transit</strong>
                  </span>
                </div>
              </div>

              {/* Out for Delivery % */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-xs relative">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider">
                      Last-Mile
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-1.5">Out for Delivery (OFD)</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="Out for Delivery (OFD)"
                      formula="Active OFD Orders in Cohort ÷ Total Shipped × 100"
                      includedStatuses={PARAMETER_STATUSES.OUT_FOR_DELIVERY}
                      calculation={`${formatNumber(metrics.outForDelivery.count)} ÷ ${formatNumber(metrics.shipped.count)} × 100 = ${metrics.outForDelivery.percent}%`}
                      explanation={`Parcels currently assigned to courier riders for active doorstep delivery attempts. Active in this order cohort: ${formatNumber(metrics.outForDelivery.count)} orders (${metrics.outForDelivery.percent}% of shipped). Real-time today scans across all orders: ${data.todayOfd?.total ?? '—'} dispatched today (${data.todayOfd?.stillOut ?? '—'} active with riders, ${data.todayOfd?.delivered ?? '—'} delivered today, ${data.todayOfd?.undelivered ?? '—'} undelivered).`}
                      notes="Click the live badge or the 'Today\'s OFD' tab above to view real-time courier attempts for today's scans."
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
                      <PackageCheck size={18} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">{metrics.outForDelivery.percent}%</strong>
                  <span className="text-xs text-muted-foreground">
                    ({formatNumber(metrics.outForDelivery.count)} active)
                  </span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setActiveMode("today_ofd")}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                    title="Switch to Today's OFD register"
                  >
                    <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
                    Today: {data.todayOfd?.total || 0} OFD ({data.todayOfd?.stillOut || 0} out) →
                  </button>
                  <span className="text-muted-foreground">
                    Active: <strong className="text-foreground">{formatNumber(metrics.outForDelivery.count)}</strong>
                  </span>
                </div>
              </div>

              {/* NDR / Undelivered Delivery Percentage (Recovery Rate) */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-xs relative">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                      Recovery
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-1.5">NDR Recovery Delivery %</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="NDR Recovery Delivery %"
                      formula="Delivered after NDR ÷ Total NDR Experienced × 100"
                      includedStatuses={[...PARAMETER_STATUSES.DELIVERED, ...PARAMETER_STATUSES.NDR]}
                      calculation={`${formatNumber(metrics.ndrDelivered.count)} ÷ ${formatNumber(metrics.totalNdrExperienced.count)} × 100 = ${metrics.ndrDeliveryRate}%`}
                      explanation="Success rate of re-attempting and successfully delivering orders that had previously failed delivery (customer unavailable, customer reschedule, incomplete address, etc.)."
                      notes={`Total NDR incidents experienced: ${formatNumber(metrics.totalNdrExperienced.count)}. Recovered to Delivered: ${formatNumber(metrics.ndrDelivered.count)}.`}
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                      <Percent size={18} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">{metrics.ndrDeliveryRate}%</strong>
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">delivered</span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Recovered: <strong className="text-foreground">{formatNumber(metrics.ndrDelivered.count)}</strong>
                  </span>
                  <span>
                    Total NDR: <strong className="text-foreground">{formatNumber(metrics.totalNdrExperienced.count)}</strong>
                  </span>
                </div>
              </div>

              {/* Avg Time to Deliver (TAT) */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-xs relative">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                      Speed
                    </span>
                    <h3 className="text-xs font-semibold text-muted-foreground mt-1.5">Avg Time to Deliver</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MetricInfoButton
                      title="Avg Turnaround Time (TAT)"
                      formula="Mean of (Delivered Date - Shipped Date)"
                      includedStatuses={PARAMETER_STATUSES.DELIVERED}
                      calculation={metrics.avgShippedTatDays != null ? `${metrics.avgShippedTatDays} days dispatch to door` : undefined}
                      explanation="The average duration in days taken from carrier handover (shipped) to doorstep delivery for completed orders across this cohort."
                      notes={`Order creation to delivery average: ${metrics.avgOrderTatDays != null ? metrics.avgOrderTatDays + ' days' : '—'}.`}
                    />
                    <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                      <Clock size={18} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-2xl font-bold tracking-tight text-foreground">
                    {metrics.avgShippedTatDays != null ? `${metrics.avgShippedTatDays} days` : "—"}
                  </strong>
                  <span className="text-xs text-muted-foreground">dispatch to door</span>
                </div>
                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Dispatch: <strong className="text-foreground">{metrics.avgShippedTatDays != null ? `${metrics.avgShippedTatDays}d` : "—"}</strong>
                  </span>
                  <span>
                    Order Date: <strong className="text-foreground">{metrics.avgOrderTatDays != null ? `${metrics.avgOrderTatDays}d` : "—"}</strong>
                  </span>
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
                  <div className="flex items-center gap-2">
                    <MetricInfoButton
                      title="Delivery Attempt Breakdown"
                      formula="Delivered on Attempt N ÷ Total Delivered × 100"
                      includedStatuses={PARAMETER_STATUSES.DELIVERED}
                      calculation={`1st attempt: ${metrics.firstAttemptDelivered.percent}% (${formatNumber(metrics.firstAttemptDelivered.count)}) · 2nd attempt: ${metrics.secondAttemptDelivered.percent}% (${formatNumber(metrics.secondAttemptDelivered.count)}) · 3rd attempt: ${metrics.thirdAttemptDelivered.percent}% (${formatNumber(metrics.thirdAttemptDelivered.count)})`}
                      explanation="Measures the distribution of delivery attempts required to successfully deliver packages. 1st attempt delivered succeeded on the initial delivery run with 0 prior failed attempts. 2nd and 3rd attempts succeeded after re-attempting following NDR exceptions."
                      notes="All attempt percentages are calculated out of total delivered shipments in this cohort."
                    />
                    <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground uppercase tracking-wide">
                      Funnel
                    </span>
                  </div>
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
                  <div className="flex items-center gap-2">
                    <MetricInfoButton
                      title="Payment Method Split & Delivery %"
                      formula="Ratio: Count ÷ Total Orders × 100. Delivery %: Delivered ÷ Shipped × 100"
                      includedStatuses={ALL_SHIPPED_STATUSES}
                      calculation={`COD: ${metrics.codRatio}% (${formatNumber(metrics.cod.count)}), ${metrics.codDeliveryRate}% del. Prepaid: ${metrics.prepaidRatio}% (${formatNumber(metrics.prepaid.count)}), ${metrics.prepaidDeliveryRate}% del.`}
                      explanation="Compares order volume split between Cash On Delivery (COD) and Prepaid, along with the actual delivery fulfillment rates achieved for each payment method across dispatched orders."
                      notes={`Prepaid delivery rate outperforms COD by ${(metrics.prepaidDeliveryRate - metrics.codDeliveryRate).toFixed(1)}%. Closed delivery rate: Prepaid ${metrics.prepaidClosedDeliveryRate}% vs COD ${metrics.codClosedDeliveryRate}%.`}
                    />
                    <CreditCard size={17} className="text-muted-foreground" />
                  </div>
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
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        COD Delivery %
                      </span>
                      <MetricInfoButton
                        title="COD Delivery %"
                        formula="COD Delivered ÷ COD Shipped × 100"
                        includedStatuses={PARAMETER_STATUSES.DELIVERED}
                        calculation={`${formatNumber(metrics.codDelivered)} ÷ ${formatNumber(metrics.codShipped)} × 100 = ${metrics.codDeliveryRate}%`}
                        explanation="Delivery success percentage specifically for Cash On Delivery (COD) orders."
                        notes={`Closed delivery rate: ${metrics.codClosedDeliveryRate}%.`}
                      />
                    </div>
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
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        Prepaid Delivery %
                      </span>
                      <MetricInfoButton
                        title="Prepaid Delivery %"
                        formula="Prepaid Delivered ÷ Prepaid Shipped × 100"
                        includedStatuses={PARAMETER_STATUSES.DELIVERED}
                        calculation={`${formatNumber(metrics.prepaidDelivered)} ÷ ${formatNumber(metrics.prepaidShipped)} × 100 = ${metrics.prepaidDeliveryRate}%`}
                        explanation="Delivery success percentage specifically for Prepaid orders."
                        notes={`Closed delivery rate: ${metrics.prepaidClosedDeliveryRate}%.`}
                      />
                    </div>
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
                    <p className="text-xs text-muted-foreground">Sorted by highest shipment volume</p>
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
                            {c.shipped === 0 ? (
                              <span className="text-muted-foreground font-mono">—</span>
                            ) : (
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
                            )}
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground font-medium">
                            {c.closed === 0 ? "—" : `${c.closedDeliveryRate}%`}
                          </td>
                          <td className="py-3 px-4 text-right text-destructive">{formatNumber(c.rto)}</td>
                          <td className="py-3 px-4 text-right font-medium text-destructive">
                            {c.shipped === 0 ? "—" : `${c.rtoRate}%`}
                          </td>
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
                <div>
                  <div className="p-3 bg-muted/30 border-b border-border text-xs text-muted-foreground">
                    <strong className="text-foreground">Order Cohort Maturation:</strong> Each row tracks orders placed on that calendar date. Recent orders (0–2 days old) are in fulfillment & line-haul transit, maturing into deliveries over 2–4 days.
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                        <tr>
                          <th className="py-3 px-4">Order Date (Cohort)</th>
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
                              {d.shipped === 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
                                  Unfulfilled
                                </span>
                              ) : d.delivered === 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                                  In Transit
                                </span>
                              ) : (
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
                              )}
                            </td>
                            <td className="py-3 px-4 text-right text-destructive">{formatNumber(d.rto)}</td>
                            <td className="py-3 px-4 text-right text-destructive font-medium">
                              {d.shipped === 0 ? "—" : `${d.rtoRate}%`}
                            </td>
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
                            {s.shipped === 0 ? (
                              <span className="text-muted-foreground font-mono">—</span>
                            ) : (
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
                            )}
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground font-medium">
                            {s.closed === 0 ? "—" : `${s.closedDeliveryRate}%`}
                          </td>
                          <td className="py-3 px-4 text-right text-destructive">{formatNumber(s.rto)}</td>
                          <td className="py-3 px-4 text-right text-destructive font-medium">
                            {s.shipped === 0 ? "—" : `${s.rtoRate}%`}
                          </td>
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
                            {p.shipped === 0 ? (
                              <span className="text-muted-foreground font-mono">—</span>
                            ) : (
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
                            )}
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground font-medium">
                            {p.shipped === 0 || p.closed === 0 ? "—" : `${p.closedDeliveryRate}%`}
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
          </div>
        )}
      </div>
    </section>
  );
}
