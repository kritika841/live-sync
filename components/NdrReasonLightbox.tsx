"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  AlertTriangle,
  UserX,
  PhoneOff,
  MapPinOff,
  Ban,
  Clock,
  CheckCircle2,
  TrendingDown,
  Search,
  Loader2,
  Truck,
  ArrowUpRight,
  BarChart2,
  Layers,
} from "lucide-react";

export interface NdrReasonSummary {
  totalIncidents: number;
  attempt1Count: number;
  attempt1Percent: number;
  attempt2Count: number;
  attempt2Percent: number;
  attempt3PlusCount: number;
  attempt3PlusPercent: number;
  recoveredDelivered: number;
  recoveryRate: number;
  rtoCount: number;
  rtoRate: number;
  avgDaysToNdr: number | null;
}

export interface AttemptHistogramBin {
  label: string;
  count: number;
  percent: number;
  color: string;
}

export interface TatHistogramBin {
  bucket: string;
  count: number;
  percent: number;
}

export interface CourierNdrItem {
  courier: string;
  count: number;
  percent: number;
}

export interface NdrOrder {
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
  ndr_reason?: string;
  ndr_attempts?: number;
  attempt_count?: number;
  ndr_raised_at?: string;
  first_out_for_delivery_at?: string;
  out_for_delivery_at?: string;
  delivered_at?: string;
}

export interface NdrReasonLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  reason: string;
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

function categorizeReason(reason: string): { label: string; color: string; icon: typeof UserX } {
  const r = reason.toLowerCase();
  if (r.includes("contactable") || r.includes("reachable") || r.includes("phone") || r.includes("unavailable") || r.includes("pna")) {
    return { label: "Contact Issue", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30", icon: PhoneOff };
  }
  if (r.includes("cancel") || r.includes("refused") || r.includes("otp")) {
    return { label: "Refusal / Cancellation", color: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30", icon: Ban };
  }
  if (r.includes("address") || r.includes("door lock") || r.includes("closed") || r.includes("area") || r.includes("pincode")) {
    return { label: "Address / Access", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30", icon: MapPinOff };
  }
  if (r.includes("date") || r.includes("delay") || r.includes("reschedule") || r.includes("tomorrow")) {
    return { label: "Rescheduled", color: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30", icon: Clock };
  }
  return { label: "Other / Uncategorized", color: "bg-muted text-muted-foreground border-border", icon: AlertTriangle };
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

export function NdrReasonLightbox({
  isOpen,
  onClose,
  reason,
  filters,
  onOpenOrderTimeline,
}: NdrReasonLightboxProps) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<NdrReasonSummary | null>(null);
  const [attemptHistogram, setAttemptHistogram] = useState<AttemptHistogramBin[]>([]);
  const [tatHistogram, setTatHistogram] = useState<TatHistogramBin[]>([]);
  const [courierHistogram, setCourierHistogram] = useState<CourierNdrItem[]>([]);
  const [orders, setOrders] = useState<NdrOrder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!isOpen || !reason) return;

    let isMounted = true;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("type", "ndr");
    params.set("reason", reason);
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
        setAttemptHistogram(data.attemptHistogram || []);
        setTatHistogram(data.tatHistogram || []);
        setCourierHistogram(data.courierHistogram || []);
        setOrders(data.orders || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load NDR reason details:", err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, reason, filters]);

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

  const cat = categorizeReason(reason);
  const CategoryIcon = cat.icon;
  const maxAttemptCount = Math.max(...attemptHistogram.map((h) => h.count), 1);
  const maxCourierCount = Math.max(...courierHistogram.map((h) => h.count), 1);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-start justify-between bg-muted/20 gap-4 shrink-0">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${cat.color}`}>
                <CategoryIcon size={12} />
                <span>{cat.label}</span>
              </span>
              <h2 className="text-lg font-bold text-foreground truncate max-w-xl" title={reason}>
                {reason}
              </h2>
              {filters.product && (
                <span className="px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 text-xs font-medium">
                  Product: {filters.product}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Detailed exception histogram across delivery attempts, recovery resolution, carrier split, and affected shipments.
            </p>
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

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-xs font-medium">Loading exception analysis and histogram...</p>
            </div>
          ) : summary ? (
            <>
              {/* Distinct Key Metrics Cards - Numbers & Percentages Separated */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {/* 1. Total Incidents */}
                <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs col-span-2 sm:col-span-1">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Total Incidents
                  </div>
                  <div className="text-2xl font-extrabold text-foreground tracking-tight mt-1">
                    {formatNumber(summary.totalIncidents)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Reported exception count
                  </div>
                </div>

                {/* 2. 1st Attempt Failures */}
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between text-sky-600 dark:text-sky-400">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">1st Attempt</span>
                    <span className="size-2 rounded-full bg-sky-500" />
                  </div>
                  <div className="text-2xl font-extrabold text-foreground tracking-tight mt-1">
                    {formatNumber(summary.attempt1Count)}
                  </div>
                  <div className="text-[11px] font-bold text-sky-600 dark:text-sky-400 mt-1">
                    {summary.attempt1Percent}% of incidents
                  </div>
                </div>

                {/* 3. 2nd Attempt Failures */}
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">2nd Attempt</span>
                    <span className="size-2 rounded-full bg-amber-500" />
                  </div>
                  <div className="text-2xl font-extrabold text-foreground tracking-tight mt-1">
                    {formatNumber(summary.attempt2Count)}
                  </div>
                  <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400 mt-1">
                    {summary.attempt2Percent}% of incidents
                  </div>
                </div>

                {/* 4. 3rd+ Attempt Failures */}
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">3rd+ Attempt</span>
                    <span className="size-2 rounded-full bg-rose-500" />
                  </div>
                  <div className="text-2xl font-extrabold text-foreground tracking-tight mt-1">
                    {formatNumber(summary.attempt3PlusCount)}
                  </div>
                  <div className="text-[11px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                    {summary.attempt3PlusPercent}% of incidents
                  </div>
                </div>

                {/* 5. Recovered & Delivered */}
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Recovered</span>
                    <CheckCircle2 size={13} />
                  </div>
                  <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tracking-tight mt-1">
                    {summary.recoveryRate}%
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {formatNumber(summary.recoveredDelivered)} delivered
                  </div>
                </div>

                {/* 6. Returned to Origin (RTO) */}
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                    <span className="text-[11px] font-semibold uppercase tracking-wider">RTO Rate</span>
                    <TrendingDown size={13} />
                  </div>
                  <div className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 tracking-tight mt-1">
                    {summary.rtoRate}%
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {formatNumber(summary.rtoCount)} returned
                  </div>
                </div>
              </div>

              {/* HISTOGRAMS ROW */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Attempt Distribution Histogram */}
                <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart2 className="size-4 text-primary" />
                    <h3 className="text-sm font-bold text-foreground">
                      Failure Distribution by Attempt
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    Histogram showing when this NDR reason occurred across delivery attempts. Numbers and percentages are presented separately.
                  </p>

                  <div className="grid grid-cols-3 gap-3 items-end h-44 border-b border-border pb-3 px-4">
                    {attemptHistogram.map((bin) => {
                      const barHeightPercent = Math.max(10, (bin.count / maxAttemptCount) * 100);
                      return (
                        <div key={bin.label} className="flex flex-col items-center h-full justify-end group">
                          {/* Number on top (Count) */}
                          <div className="text-xs font-bold text-foreground mb-1 text-center transition-transform group-hover:scale-110">
                            {formatNumber(bin.count)}
                          </div>

                          {/* Vertical Bar */}
                          <div className="w-full max-w-[64px] h-32 bg-muted/40 dark:bg-muted/20 border border-border/40 rounded-t-lg overflow-hidden flex flex-col justify-end p-0.5 shadow-inner">
                            <div
                              className={`w-full ${bin.color} rounded-t-md transition-all duration-500 shadow-sm`}
                              style={{ height: `${barHeightPercent}%` }}
                            />
                          </div>

                          {/* Attempt Label */}
                          <div className="mt-2 text-xs font-semibold text-foreground text-center">
                            {bin.label}
                          </div>

                          {/* Percentage Badge */}
                          <div className="mt-0.5 text-[10px] font-bold px-2 py-0.2 rounded bg-muted text-foreground">
                            {bin.percent}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Courier Distribution Histogram */}
                <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
                  <div className="flex items-center gap-2 mb-3">
                    <Truck className="size-4 text-primary" />
                    <h3 className="text-sm font-bold text-foreground">
                      Courier Distribution for this Reason
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    Carriers with the highest occurrences of this non-delivery exception.
                  </p>

                  <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                    {courierHistogram.map((c) => {
                      const widthPct = Math.max(4, (c.count / maxCourierCount) * 100);
                      return (
                        <div key={c.courier} className="text-xs">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-foreground truncate max-w-[200px]">
                              {c.courier}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground">{formatNumber(c.count)}</span>
                              <span className="text-[10px] font-semibold text-muted-foreground px-1.5 py-0.2 rounded bg-muted">
                                {c.percent}%
                              </span>
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
                    {courierHistogram.length === 0 && (
                      <div className="py-8 text-center text-xs text-muted-foreground">
                        No courier breakdown data available.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ORDERS DRILLDOWN TABLE */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs space-y-3">
                <div className="p-4 border-b border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20">
                  <div>
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <span>Affected Shipments ({formatNumber(filteredOrders.length)})</span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Review individual shipments flagged with &quot;{reason}&quot; and view their attempt progression
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
                        <th className="py-2.5 px-4">Status Outcome</th>
                        <th className="py-2.5 px-4 text-center">NDR Attempts</th>
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
                          <td className="py-3 px-4 font-medium text-foreground">
                            {ord.courier || "—"}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                                ord.status === "DELIVERED"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                  : ord.status?.includes("RTO")
                                  ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              }`}
                            >
                              {ord.status || "NDR"}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="font-bold text-foreground">
                              {ord.ndr_attempts || ord.attempt_count || 1}
                            </span>
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
                          <td colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                            No orders found matching &quot;{searchQuery}&quot;
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
              Unable to load details for this NDR reason.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground bg-muted/20 shrink-0">
          <span>Exception cohort scoped by current filter set</span>
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
