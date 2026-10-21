"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Clock,
  Truck,
  CheckCircle2,
  TrendingUp,
  Search,
  ExternalLink,
  Loader2,
  Calendar,
  Layers,
  IndianRupee,
  BarChart2,
  ArrowUpRight,
  MapPin,
} from "lucide-react";

export interface DeliveryAttemptSummary {
  attempt: number;
  deliveredCount: number;
  shippedCount: number;
  allDeliveredCount: number;
  deliveryRate: number; // % of shipped
  shareOfDelivered: number; // % of delivered
  avgTatDays: number | null;
  totalRevenue: number;
  codCount: number;
  prepaidCount: number;
}

export interface TatHistogramItem {
  bucket: string;
  count: number;
  percent: number;
}

export interface CourierHistogramItem {
  courier: string;
  count: number;
  percent: number;
  avgTat: number | null;
}

export interface StateHistogramItem {
  state: string;
  count: number;
  percent: number;
  avgTat: number | null;
}

export interface CohortOrder {
  id: string | number;
  channel_order_id?: string;
  awb?: string;
  courier?: string;
  customer_name?: string;
  customer_city?: string;
  customer_state?: string;
  payment_method?: string;
  total?: number;
  order_date?: string;
  status?: string;
  attempt_count?: number;
  ndr_attempts?: number;
  delivered_at?: string;
  tat_days?: number;
}

export interface DeliveryAttemptLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  attempt: number;
  filters: {
    from?: string;
    to?: string;
    courier?: string;
    payment?: string;
    state?: string;
    product?: string;
    risk?: string;
  };
  onOpenOrderTimeline?: (order: { id: string | number; channelOrderId?: string; awb?: string }) => void;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function DeliveryAttemptLightbox({
  isOpen,
  onClose,
  attempt,
  filters,
  onOpenOrderTimeline,
}: DeliveryAttemptLightboxProps) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DeliveryAttemptSummary | null>(null);
  const [tatHistogram, setTatHistogram] = useState<TatHistogramItem[]>([]);
  const [courierHistogram, setCourierHistogram] = useState<CourierHistogramItem[]>([]);
  const [stateHistogram, setStateHistogram] = useState<StateHistogramItem[]>([]);
  const [orders, setOrders] = useState<CohortOrder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"tat" | "courier" | "state">("tat");

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("type", "delivered");
    params.set("attempt", String(attempt));
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.courier) params.set("courier", filters.courier);
    if (filters.payment) params.set("payment", filters.payment);
    if (filters.state) params.set("state", filters.state);
    if (filters.product) params.set("product", filters.product);
    if (filters.risk) params.set("risk", filters.risk);

    fetch(`/api/analytics/attempt-cohort?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        setSummary(data.summary || null);
        setTatHistogram(data.tatHistogram || []);
        setCourierHistogram(data.courierHistogram || []);
        setStateHistogram(data.stateHistogram || []);
        setOrders(data.orders || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load attempt cohort details:", err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, attempt, filters]);

  // Filtered orders list
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.toLowerCase();
    return orders.filter(
      (o) =>
        String(o.channel_order_id || o.id).toLowerCase().includes(q) ||
        String(o.awb || "").toLowerCase().includes(q) ||
        String(o.customer_name || "").toLowerCase().includes(q) ||
        String(o.customer_city || "").toLowerCase().includes(q) ||
        String(o.courier || "").toLowerCase().includes(q)
    );
  }, [orders, searchQuery]);

  if (!isOpen) return null;

  const attemptTitle =
    attempt === 1
      ? "1st Attempt Delivery Cohort"
      : attempt === 2
      ? "2nd Attempt Delivery Cohort"
      : attempt === 3
      ? "3rd Attempt Delivery Cohort"
      : "4th+ Attempt Delivery Cohort";

  const attemptSubtitle =
    attempt === 1
      ? "Initial delivery run success with zero prior non-delivery exceptions"
      : attempt === 2
      ? "Recovered & successfully delivered on 2nd attempt following initial NDR"
      : attempt === 3
      ? "Successfully delivered on 3rd attempt after consecutive re-attempt runs"
      : "Multi-attempt resolution successes requiring 4 or more delivery runs";

  const badgeColor =
    attempt === 1
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : attempt === 2
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
      : attempt === 3
      ? "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30"
      : "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30";

  const maxTatCount = Math.max(...tatHistogram.map((h) => h.count), 1);
  const maxCourierCount = Math.max(...courierHistogram.map((h) => h.count), 1);
  const maxStateCount = Math.max(...stateHistogram.map((s) => s.count), 1);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-start justify-between bg-muted/20 gap-4 shrink-0">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${badgeColor}`}>
                Attempt {attempt >= 4 ? "4+" : attempt}
              </span>
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <span>{attemptTitle}</span>
              </h2>
              {filters.product && (
                <span className="px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 text-xs font-medium">
                  Product: {filters.product}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{attemptSubtitle}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 transition"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-xs font-medium">Computing attempt cohort distributions & histogram bins...</p>
            </div>
          ) : summary ? (
            <>
              {/* Distinct Key Metrics Cards - Numbers & Percentages Separated */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {/* 1. Delivered Count (Number) */}
                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <div className="flex items-center justify-between text-muted-foreground mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Delivered Orders</span>
                    <CheckCircle2 size={14} className="text-emerald-500" />
                  </div>
                  <div className="text-2xl font-extrabold text-foreground tracking-tight">
                    {formatNumber(summary.deliveredCount)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Delivered on Attempt {attempt >= 4 ? "4+" : attempt}
                  </div>
                </div>

                {/* 2. % of Shipped (Delivery Rate) */}
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between text-sky-600 dark:text-sky-400 mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Delivery Rate</span>
                    <TrendingUp size={14} />
                  </div>
                  <div className="text-2xl font-extrabold text-sky-600 dark:text-sky-400 tracking-tight">
                    {summary.deliveryRate}%
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Out of {formatNumber(summary.shippedCount)} shipped orders
                  </div>
                </div>

                {/* 3. Share of Delivered (%) */}
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between text-purple-600 dark:text-purple-400 mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Share of Delivered</span>
                    <Layers size={14} />
                  </div>
                  <div className="text-2xl font-extrabold text-purple-600 dark:text-purple-400 tracking-tight">
                    {summary.shareOfDelivered}%
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Of {formatNumber(summary.allDeliveredCount)} total deliveries
                  </div>
                </div>

                {/* 4. Avg TAT Days */}
                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <div className="flex items-center justify-between text-muted-foreground mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Avg Turnaround</span>
                    <Clock size={14} className="text-amber-500" />
                  </div>
                  <div className="text-2xl font-extrabold text-foreground tracking-tight">
                    {summary.avgTatDays != null ? `${summary.avgTatDays} d` : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Shipped to delivered timeline
                  </div>
                </div>

                {/* 5. Revenue & Payment Split */}
                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs col-span-2 sm:col-span-1">
                  <div className="flex items-center justify-between text-muted-foreground mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Delivered Value</span>
                    <IndianRupee size={14} className="text-emerald-500" />
                  </div>
                  <div className="text-xl font-extrabold text-foreground tracking-tight truncate">
                    {formatCurrency(summary.totalRevenue)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
                    <span>COD: <strong>{formatNumber(summary.codCount)}</strong></span>
                    <span>·</span>
                    <span>Prepaid: <strong>{formatNumber(summary.prepaidCount)}</strong></span>
                  </div>
                </div>
              </div>

              {/* DEDICATED HISTOGRAM VIEWS */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
                {/* Histogram Navigation Tabs */}
                <div className="p-4 border-b border-border/80 flex items-center justify-between bg-muted/20 flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="size-4 text-primary" />
                    <h3 className="text-sm font-bold text-foreground">
                      {activeTab === "tat"
                        ? "Delivery Turnaround Time (TAT) Histogram"
                        : activeTab === "courier"
                        ? "Courier Volume & Speed Distribution"
                        : "State Volume & Average TAT Distribution"}
                    </h3>
                  </div>

                  <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-xs text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveTab("tat")}
                      className={`px-3 py-1 rounded-md transition font-medium ${
                        activeTab === "tat"
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      TAT Distribution (Days)
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("courier")}
                      className={`px-3 py-1 rounded-md transition font-medium ${
                        activeTab === "courier"
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Courier Breakdown
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("state")}
                      className={`px-3 py-1 rounded-md transition font-medium ${
                        activeTab === "state"
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      State TAT Breakdown
                    </button>
                  </div>
                </div>

                <div className="p-5">
                  {/* View 1: TAT Distribution Histogram */}
                  {activeTab === "tat" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">
                        Histogram showing number of days taken to successfully deliver orders in this cohort. Bars display order volume and percentage share separately.
                      </p>

                      {/* Histogram Vertical Columns */}
                      <div className="pt-8 pb-4 px-2">
                        <div className="grid grid-cols-7 gap-2 sm:gap-4 items-end h-56 border-b border-border pb-3">
                          {tatHistogram.map((bin) => {
                            const barHeightPercent = Math.max(8, (bin.count / maxTatCount) * 100);
                            return (
                              <div key={bin.bucket} className="flex flex-col items-center h-full justify-end group">
                                {/* Number on Top (Count) */}
                                <div className="text-[11px] font-bold text-foreground mb-1.5 text-center transition-transform group-hover:scale-110">
                                  {formatNumber(bin.count)}
                                </div>

                                {/* Histogram Bar with explicit height container */}
                                <div className="w-full max-w-[52px] h-36 sm:h-40 bg-muted/40 dark:bg-muted/20 border border-border/40 rounded-t-lg overflow-hidden flex flex-col justify-end p-0.5 relative shadow-inner">
                                  <div
                                    className="w-full bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-400 dark:hover:bg-emerald-300 rounded-t-md transition-all duration-500 shadow-sm"
                                    style={{ height: `${barHeightPercent}%` }}
                                  />
                                </div>

                                {/* Bucket X-Axis Label */}
                                <div className="mt-2 text-[11px] font-semibold text-foreground text-center truncate w-full">
                                  {bin.bucket}
                                </div>

                                {/* Percentage Badge (Separated below) */}
                                <div className="mt-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 px-1.5 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/20">
                                  {bin.percent}%
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* View 2: Courier Breakdown */}
                  {activeTab === "courier" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">
                        Volume and turnaround speed comparison across carrier partners delivering packages on Attempt {attempt >= 4 ? "4+" : attempt}.
                      </p>

                      <div className="space-y-3">
                        {courierHistogram.map((c) => {
                          const widthPct = Math.max(3, (c.count / maxCourierCount) * 100);
                          return (
                            <div key={c.courier} className="p-3 rounded-xl border border-border/80 bg-muted/10">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1 mb-2">
                                <span className="font-bold text-foreground flex items-center gap-2">
                                  <Truck size={13} className="text-muted-foreground" />
                                  <span>{c.courier}</span>
                                </span>
                                <div className="flex items-center gap-3">
                                  <span className="text-muted-foreground">
                                    Orders: <strong className="text-foreground">{formatNumber(c.count)}</strong>
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-muted text-[11px] font-bold text-primary">
                                    {c.percent}%
                                  </span>
                                  {c.avgTat != null && (
                                    <span className="text-muted-foreground text-[11px]">
                                      Avg TAT: <strong>{c.avgTat} d</strong>
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full transition-all duration-500"
                                  style={{ width: `${widthPct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* View 3: State Breakdown with TAT */}
                  {activeTab === "state" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">
                        Volume and turnaround speed (Avg TAT in days) across destination states for packages delivered on Attempt {attempt >= 4 ? "4+" : attempt}.
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1">
                        {stateHistogram.map((s) => {
                          const widthPct = Math.max(3, (s.count / maxStateCount) * 100);
                          return (
                            <div key={s.state} className="p-3 rounded-xl border border-border/80 bg-muted/10 hover:bg-muted/20 transition">
                              <div className="flex items-center justify-between text-xs gap-1 mb-2">
                                <span className="font-bold text-foreground flex items-center gap-1.5 truncate">
                                  <MapPin size={13} className="text-primary shrink-0" />
                                  <span className="truncate">{s.state}</span>
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-muted-foreground">
                                    <strong>{formatNumber(s.count)}</strong> orders
                                  </span>
                                  <span className="px-1.5 py-0.2 rounded bg-muted text-[11px] font-bold text-foreground">
                                    {s.percent}%
                                  </span>
                                  {s.avgTat != null ? (
                                    <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${
                                      s.avgTat <= 3
                                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                                        : s.avgTat <= 5
                                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
                                        : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20"
                                    }`}>
                                      TAT: {s.avgTat} d
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground font-mono">TAT: —</span>
                                  )}
                                </div>
                              </div>
                              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full transition-all duration-500"
                                  style={{ width: `${widthPct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                        {stateHistogram.length === 0 && (
                          <div className="col-span-2 py-8 text-center text-xs text-muted-foreground">
                            No state data recorded for this attempt cohort.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* COHORT ORDERS DRILLDOWN TABLE */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs space-y-3">
                <div className="p-4 border-b border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20">
                  <div>
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <span>Delivered Shipments in this Cohort</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                        {formatNumber(filteredOrders.length)} orders
                      </span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Inspect individual deliveries, actual TAT days, and click to view the full attempts progression
                    </p>
                  </div>

                  <div className="relative max-w-xs w-full">
                    <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search order ID, AWB, customer..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-hidden focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                      <tr>
                        <th className="py-2.5 px-4">Order ID & AWB</th>
                        <th className="py-2.5 px-4">Customer & City</th>
                        <th className="py-2.5 px-4">Courier</th>
                        <th className="py-2.5 px-4">Method & Total</th>
                        <th className="py-2.5 px-4 text-center">Attempts</th>
                        <th className="py-2.5 px-4 text-center">TAT (Days)</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredOrders.map((ord) => (
                        <tr key={String(ord.id)} className="hover:bg-muted/30 transition">
                          <td className="py-3 px-4">
                            <div className="font-bold text-foreground">
                              #{ord.channel_order_id || ord.id}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              {ord.awb || "No AWB"}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-foreground truncate max-w-[150px]">
                              {ord.customer_name || "—"}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate max-w-[150px]">
                              {[ord.customer_city, ord.customer_state].filter(Boolean).join(", ") || "—"}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-foreground">{ord.courier || "—"}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-foreground">
                              {formatCurrency(Number(ord.total || 0))}
                            </span>
                            <div className="text-[10px] uppercase font-bold text-muted-foreground">
                              {ord.payment_method || "COD"}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeColor}`}>
                              Att {ord.attempt_count || attempt}
                            </span>
                            {Number(ord.ndr_attempts || 0) > 0 && (
                              <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                {ord.ndr_attempts} NDRs
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center font-bold text-foreground">
                            {ord.tat_days != null ? `${ord.tat_days} d` : "—"}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {onOpenOrderTimeline && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenOrderTimeline({
                                    id: ord.id,
                                    channelOrderId: ord.channel_order_id,
                                    awb: ord.awb,
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition"
                              >
                                <span>Timeline</span>
                                <ArrowUpRight size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filteredOrders.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-xs text-muted-foreground">
                            No shipments found matching &quot;{searchQuery}&quot;
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-xs text-muted-foreground">
              Unable to load cohort statistics.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground bg-muted/20 shrink-0">
          <span>Cohort scoped by active analytics filters (Dates, Courier, Product, Payment, State)</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-border bg-card text-foreground font-semibold hover:bg-muted transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
