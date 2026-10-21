"use client";

import React, { useState, useMemo } from "react";
import {
  BarChart3,
  Table as TableIcon,
  AlertTriangle,
  UserX,
  PhoneOff,
  MapPinOff,
  Ban,
  Clock,
  ExternalLink,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import { NdrReasonLightbox } from "./NdrReasonLightbox";

export interface NdrReasonItem {
  reason: string;
  count: number;
  percent: number;
  attempt1Count?: number;
  attempt2Count?: number;
  attempt3PlusCount?: number;
}

export interface NdrAttemptTotals {
  all: number;
  attempt1: number;
  attempt2: number;
  attempt3Plus: number;
}

export interface NdrReasonsPlotProps {
  reasons: NdrReasonItem[];
  totals?: NdrAttemptTotals;
  subSearch?: string;
  productName?: string;
  filters?: {
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

export function NdrReasonsPlot({
  reasons = [],
  totals,
  subSearch = "",
  productName = "",
  filters = {},
  onOpenOrderTimeline,
}: NdrReasonsPlotProps) {
  const [attemptFilter, setAttemptFilter] = useState<"all" | "attempt1" | "attempt2" | "attempt3">("all");
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [hoveredReason, setHoveredReason] = useState<string | null>(null);
  const [selectedReasonForLightbox, setSelectedReasonForLightbox] = useState<string | null>(null);

  // Compute overall counts
  const computedTotals = useMemo(() => {
    const all = totals?.all || reasons.reduce((s, r) => s + r.count, 0);
    const att1 = totals?.attempt1 || reasons.reduce((s, r) => s + (r.attempt1Count || 0), 0);
    const att2 = totals?.attempt2 || reasons.reduce((s, r) => s + (r.attempt2Count || 0), 0);
    const att3 = totals?.attempt3Plus || reasons.reduce((s, r) => s + (r.attempt3PlusCount || 0), 0);
    return { all, attempt1: att1, attempt2: att2, attempt3Plus: att3 };
  }, [totals, reasons]);

  // Filtered and sorted reasons
  const processedReasons = useMemo(() => {
    let list = reasons;
    if (subSearch.trim()) {
      const term = subSearch.toLowerCase();
      list = list.filter((r) => r.reason.toLowerCase().includes(term));
    }

    if (attemptFilter === "attempt1") {
      list = [...list].sort((a, b) => (b.attempt1Count || 0) - (a.attempt1Count || 0));
    } else if (attemptFilter === "attempt2") {
      list = [...list].sort((a, b) => (b.attempt2Count || 0) - (a.attempt2Count || 0));
    } else if (attemptFilter === "attempt3") {
      list = [...list].sort((a, b) => (b.attempt3PlusCount || 0) - (a.attempt3PlusCount || 0));
    } else {
      list = [...list].sort((a, b) => b.count - a.count);
    }

    return list;
  }, [reasons, subSearch, attemptFilter]);

  // Max value for scaling visual bars
  const maxBarValue = useMemo(() => {
    if (processedReasons.length === 0) return 1;
    if (attemptFilter === "attempt1") {
      return Math.max(...processedReasons.map((r) => r.attempt1Count || 0), 1);
    }
    if (attemptFilter === "attempt2") {
      return Math.max(...processedReasons.map((r) => r.attempt2Count || 0), 1);
    }
    if (attemptFilter === "attempt3") {
      return Math.max(...processedReasons.map((r) => r.attempt3PlusCount || 0), 1);
    }
    return Math.max(...processedReasons.map((r) => r.count), 1);
  }, [processedReasons, attemptFilter]);

  return (
    <div className="p-5 space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="size-4 text-primary" />
              <span>Top Non-Delivery Reasons (NDR) — Plotted Distribution</span>
            </h3>
            {productName && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20 max-w-[200px] truncate">
                Product: {productName}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click on any reason to open its dedicated histogram lightbox with attempt distribution, resolution outcomes, and affected shipments.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Attempt Cohort Filter Pills */}
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-xs text-xs font-medium">
            <button
              type="button"
              onClick={() => setAttemptFilter("all")}
              className={`px-2.5 py-1 rounded-md transition ${
                attemptFilter === "all"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Attempts
            </button>
            <button
              type="button"
              onClick={() => setAttemptFilter("attempt1")}
              className={`px-2.5 py-1 rounded-md transition ${
                attemptFilter === "attempt1"
                  ? "bg-sky-600 text-white font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              1st Attempt
            </button>
            <button
              type="button"
              onClick={() => setAttemptFilter("attempt2")}
              className={`px-2.5 py-1 rounded-md transition ${
                attemptFilter === "attempt2"
                  ? "bg-amber-600 text-white font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              2nd Attempt
            </button>
            <button
              type="button"
              onClick={() => setAttemptFilter("attempt3")}
              className={`px-2.5 py-1 rounded-md transition ${
                attemptFilter === "attempt3"
                  ? "bg-rose-600 text-white font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              3rd+ Attempt
            </button>
          </div>

          {/* View Toggle */}
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-xs text-xs">
            <button
              type="button"
              onClick={() => setViewMode("chart")}
              className={`p-1.5 rounded-md transition flex items-center gap-1 ${
                viewMode === "chart"
                  ? "bg-muted text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Card Plot View"
            >
              <BarChart3 size={14} />
              <span className="hidden sm:inline">Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded-md transition flex items-center gap-1 ${
                viewMode === "table"
                  ? "bg-muted text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Data Table View"
            >
              <TableIcon size={14} />
              <span className="hidden sm:inline">Table</span>
            </button>
          </div>
        </div>
      </div>

      {/* Cohort Summary KPI Cards - Delivery Numbers and Percentages Clearly Separated */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total Incidents */}
        <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Total NDR Incidents</p>
          <p className="text-2xl font-extrabold text-foreground mt-1">{formatNumber(computedTotals.all)}</p>
          <div className="mt-1 inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
            100% of reported exceptions
          </div>
        </div>

        {/* 1st Attempt Failures */}
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-sky-600 dark:text-sky-400">
            <p className="text-[11px] font-semibold uppercase tracking-wider">1st Attempt Failures</p>
            <span className="size-2 rounded-full bg-sky-500" />
          </div>
          <p className="text-2xl font-extrabold text-foreground mt-1">{formatNumber(computedTotals.attempt1)}</p>
          <div className="mt-1 inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
            {computedTotals.all > 0 ? ((computedTotals.attempt1 / computedTotals.all) * 100).toFixed(1) : 0}% of all NDRs
          </div>
        </div>

        {/* 2nd Attempt Failures */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
            <p className="text-[11px] font-semibold uppercase tracking-wider">2nd Attempt Failures</p>
            <span className="size-2 rounded-full bg-amber-500" />
          </div>
          <p className="text-2xl font-extrabold text-foreground mt-1">{formatNumber(computedTotals.attempt2)}</p>
          <div className="mt-1 inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
            {computedTotals.all > 0 ? ((computedTotals.attempt2 / computedTotals.all) * 100).toFixed(1) : 0}% of all NDRs
          </div>
        </div>

        {/* 3rd+ Attempt Failures */}
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
            <p className="text-[11px] font-semibold uppercase tracking-wider">3rd+ Attempt Failures</p>
            <span className="size-2 rounded-full bg-rose-500" />
          </div>
          <p className="text-2xl font-extrabold text-foreground mt-1">{formatNumber(computedTotals.attempt3Plus)}</p>
          <div className="mt-1 inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300">
            {computedTotals.all > 0 ? ((computedTotals.attempt3Plus / computedTotals.all) * 100).toFixed(1) : 0}% of all NDRs
          </div>
        </div>
      </div>

      {/* Visual Chart View */}
      {viewMode === "chart" && (
        <div className="space-y-4">
          {/* Legend */}
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground bg-muted/20 border border-border/50 rounded-xl p-3">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="font-semibold text-foreground text-[11px] uppercase tracking-wider">Legend:</span>
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-sky-500 shrink-0" />
                <span>1st Attempt Failure</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-amber-500 shrink-0" />
                <span>2nd Attempt Failure</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-rose-500 shrink-0" />
                <span>3rd+ Attempt Failure</span>
              </div>
            </div>

            <div className="text-[11px] text-primary font-medium flex items-center gap-1">
              <ArrowUpRight size={13} />
              <span>Click any card to open dedicated Histogram Lightbox</span>
            </div>
          </div>

          {/* Plotted Stacked Reason Cards */}
          <div className="space-y-3.5">
            {processedReasons.map((item, idx) => {
              const att1 = item.attempt1Count || 0;
              const att2 = item.attempt2Count || 0;
              const att3 = item.attempt3PlusCount || 0;
              const totalForReason = item.count;
              const cat = categorizeReason(item.reason);
              const CategoryIcon = cat.icon;

              // Relative widths
              const att1PctOfMax = (att1 / maxBarValue) * 100;
              const att2PctOfMax = (att2 / maxBarValue) * 100;
              const att3PctOfMax = (att3 / maxBarValue) * 100;

              // Proportions within the reason
              const att1Share = totalForReason > 0 ? ((att1 / totalForReason) * 100).toFixed(1) : "0";
              const att2Share = totalForReason > 0 ? ((att2 / totalForReason) * 100).toFixed(1) : "0";
              const att3Share = totalForReason > 0 ? ((att3 / totalForReason) * 100).toFixed(1) : "0";

              const isHovered = hoveredReason === item.reason;

              return (
                <div
                  key={item.reason}
                  onMouseEnter={() => setHoveredReason(item.reason)}
                  onMouseLeave={() => setHoveredReason(null)}
                  onClick={() => setSelectedReasonForLightbox(item.reason)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all duration-150 ${
                    isHovered
                      ? "border-primary/50 bg-primary/5 shadow-md -translate-y-0.5"
                      : "border-border/80 bg-card hover:border-primary/30"
                  }`}
                >
                  {/* Top line: Rank, Reason title, Category Tag, and Total Metric */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="size-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-sm text-foreground truncate" title={item.reason}>
                        {item.reason}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border shrink-0 ${cat.color}`}>
                        <CategoryIcon size={10} />
                        <span>{cat.label}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs self-end sm:self-auto shrink-0">
                      <span className="text-[11px] text-muted-foreground uppercase font-semibold">Total:</span>
                      <span className="font-extrabold text-foreground text-sm">{formatNumber(item.count)}</span>
                      <span className="px-2 py-0.5 rounded bg-muted text-xs font-bold text-muted-foreground">
                        {item.percent}% of NDRs
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedReasonForLightbox(item.reason);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 text-[11px] font-semibold transition ml-1"
                      >
                        <span>Histogram</span>
                        <ArrowUpRight size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Horizontal Bar Breakdown */}
                  <div className="h-3 w-full bg-muted/60 rounded-full overflow-hidden flex relative shadow-inner">
                    {attemptFilter === "all" ? (
                      <>
                        {att1PctOfMax > 0 && (
                          <div
                            className="h-full bg-sky-500 hover:bg-sky-400 transition-all duration-300"
                            style={{ width: `${att1PctOfMax}%` }}
                            title={`1st Attempt: ${formatNumber(att1)} (${att1Share}%)`}
                          />
                        )}
                        {att2PctOfMax > 0 && (
                          <div
                            className="h-full bg-amber-500 hover:bg-amber-400 transition-all duration-300"
                            style={{ width: `${att2PctOfMax}%` }}
                            title={`2nd Attempt: ${formatNumber(att2)} (${att2Share}%)`}
                          />
                        )}
                        {att3PctOfMax > 0 && (
                          <div
                            className="h-full bg-rose-500 hover:bg-rose-400 transition-all duration-300"
                            style={{ width: `${att3PctOfMax}%` }}
                            title={`3rd+ Attempt: ${formatNumber(att3)} (${att3Share}%)`}
                          />
                        )}
                      </>
                    ) : attemptFilter === "attempt1" ? (
                      <div
                        className="h-full bg-sky-500 transition-all duration-300"
                        style={{ width: `${att1PctOfMax}%` }}
                        title={`1st Attempt: ${formatNumber(att1)}`}
                      />
                    ) : attemptFilter === "attempt2" ? (
                      <div
                        className="h-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${att2PctOfMax}%` }}
                        title={`2nd Attempt: ${formatNumber(att2)}`}
                      />
                    ) : (
                      <div
                        className="h-full bg-rose-500 transition-all duration-300"
                        style={{ width: `${att3PctOfMax}%` }}
                        title={`3rd+ Attempt: ${formatNumber(att3)}`}
                      />
                    )}
                  </div>

                  {/* DISTINCT SEPARATION OF NUMBERS AND PERCENTAGES */}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    {/* 1st Attempt Column */}
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-sky-500 shrink-0" />
                        <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">1st Attempt</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-foreground">{formatNumber(att1)}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-800 dark:text-sky-200">
                          {att1Share}%
                        </span>
                      </div>
                    </div>

                    {/* 2nd Attempt Column */}
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-amber-500 shrink-0" />
                        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">2nd Attempt</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-foreground">{formatNumber(att2)}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200">
                          {att2Share}%
                        </span>
                      </div>
                    </div>

                    {/* 3rd+ Attempt Column */}
                    <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-rose-500 shrink-0" />
                        <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">3rd+ Attempt</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-foreground">{formatNumber(att3)}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-800 dark:text-rose-200">
                          {att3Share}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {processedReasons.length === 0 && (
              <div className="py-12 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                No NDR reasons recorded for this filter selection.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Data Table View - Numbers & Percentages In Dedicated Columns */}
      {viewMode === "table" && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
              <tr>
                <th className="py-3 px-4"># Rank & NDR Reason</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Total Incidents</th>
                <th className="py-3 px-4 text-right">% of All NDRs</th>
                <th className="py-3 px-4 text-right text-sky-600 dark:text-sky-400">1st Att (Count)</th>
                <th className="py-3 px-4 text-right text-sky-600 dark:text-sky-400">1st Att (%)</th>
                <th className="py-3 px-4 text-right text-amber-600 dark:text-amber-400">2nd Att (Count)</th>
                <th className="py-3 px-4 text-right text-amber-600 dark:text-amber-400">2nd Att (%)</th>
                <th className="py-3 px-4 text-right text-rose-600 dark:text-rose-400">3rd+ Att (Count)</th>
                <th className="py-3 px-4 text-right text-rose-600 dark:text-rose-400">3rd+ Att (%)</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {processedReasons.map((item, idx) => {
                const cat = categorizeReason(item.reason);
                const att1 = item.attempt1Count || 0;
                const att2 = item.attempt2Count || 0;
                const att3 = item.attempt3PlusCount || 0;
                const att1Pct = item.count > 0 ? ((att1 / item.count) * 100).toFixed(1) : "0";
                const att2Pct = item.count > 0 ? ((att2 / item.count) * 100).toFixed(1) : "0";
                const att3Pct = item.count > 0 ? ((att3 / item.count) * 100).toFixed(1) : "0";

                return (
                  <tr
                    key={item.reason}
                    onClick={() => setSelectedReasonForLightbox(item.reason)}
                    className="hover:bg-muted/30 transition cursor-pointer"
                  >
                    <td className="py-3 px-4 font-semibold text-foreground flex items-center gap-2">
                      <span className="size-5 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                        {idx + 1}
                      </span>
                      <span>{item.reason}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${cat.color}`}>
                        {cat.label}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-foreground">
                      {formatNumber(item.count)}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-muted-foreground">
                      {item.percent}%
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-sky-600 dark:text-sky-400">
                      {formatNumber(att1)}
                    </td>
                    <td className="py-3 px-4 text-right text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                      {att1Pct}%
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-amber-600 dark:text-amber-400">
                      {formatNumber(att2)}
                    </td>
                    <td className="py-3 px-4 text-right text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      {att2Pct}%
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-rose-600 dark:text-rose-400">
                      {formatNumber(att3)}
                    </td>
                    <td className="py-3 px-4 text-right text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                      {att3Pct}%
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedReasonForLightbox(item.reason);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 text-[11px] font-semibold transition"
                      >
                        <span>Histogram</span>
                        <ArrowUpRight size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {processedReasons.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-xs text-muted-foreground">
                    No NDR reasons recorded for this cohort.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* DEDICATED NDR REASON LIGHTBOX */}
      {selectedReasonForLightbox && (
        <NdrReasonLightbox
          isOpen={Boolean(selectedReasonForLightbox)}
          onClose={() => setSelectedReasonForLightbox(null)}
          reason={selectedReasonForLightbox}
          filters={filters}
          onOpenOrderTimeline={onOpenOrderTimeline}
        />
      )}
    </div>
  );
}
