"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X, Loader2, AlertTriangle, TrendingDown, Search, ChevronRight } from "lucide-react";
import { TrendLineChart } from "./TrendLineChart";

export interface ExceptionFilters {
  from?: string; to?: string; courier?: string; payment?: string; state?: string; product?: string;
}

interface ReasonRow {
  reason: string; count: number; percent: number;
  attempt1: number; attempt2: number; attempt3Plus: number; delivered: number; rto: number;
}
interface FunnelRow {
  attempt: number; label: string; delivered: number; rto: number;
  incrementalDeliveryPct: number; cumulativeDeliveryPct: number; cumulativeRtoPct: number;
}
interface ExceptionOrder {
  id: number | string; channel_order_id?: string; awb?: string; courier?: string; customer_name?: string;
  customer_city?: string; customer_state?: string; payment_method?: string; total?: number; status?: string;
  reason?: string; attempts?: number; ndr_raised_at?: string; order_date?: string;
}
interface ExceptionPayload {
  totalIncidents: number; shipped: number; reasons: ReasonRow[]; attemptFunnel: FunnelRow[]; orders: ExceptionOrder[];
}

interface Props {
  type: "ndr" | "rto" | null;
  onClose: () => void;
  filters: ExceptionFilters;
  onOpenOrderTimeline: (order: { id: number | string; channelOrderId?: string; awb?: string }) => void;
}

const REASON_COLORS = ["#f43f5e", "#f59e0b", "#6366f1", "#10b981", "#0ea5e9", "#a855f7", "#ec4899", "#84cc16"];

export function ExceptionsLightbox({ type, onClose, filters, onOpenOrderTimeline }: Props) {
  const [data, setData] = useState<ExceptionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    if (!type) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null); setSelected(null);
    const params = new URLSearchParams({ type });
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    fetch(`/api/analytics/exceptions?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed to load"); setData(j); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, filterKey]);

  useEffect(() => {
    if (!type) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [type, onClose]);

  const reasons = useMemo(() => {
    const list = data?.reasons || [];
    const term = search.trim().toLowerCase();
    return term ? list.filter((r) => r.reason.toLowerCase().includes(term)) : list;
  }, [data, search]);

  const orders = useMemo(() => {
    const list = data?.orders || [];
    return selected ? list.filter((o) => o.reason === selected) : list;
  }, [data, selected]);

  if (!type) return null;
  const isRto = type === "rto";
  const accent = isRto ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400";
  const maxCount = Math.max(1, ...(data?.reasons || []).map((r) => r.count));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border bg-muted/20 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className={`flex size-9 items-center justify-center rounded-lg ${isRto ? "bg-rose-500/10" : "bg-amber-500/10"} ${accent}`}>
              {isRto ? <TrendingDown size={18} /> : <AlertTriangle size={18} />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">{isRto ? "RTO — Reasons & Attempt History" : "NDR — Reasons & Attempt History"}</h2>
              <p className="text-[11px] text-muted-foreground">
                {data ? `${data.totalIncidents.toLocaleString("en-IN")} ${isRto ? "returned orders" : "NDR incidents"} · respects your active filters` : "Loading…"}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          {loading && <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
          {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>}

          {data && (
            <>
              <section>
                <h3 className="text-xs font-bold text-foreground">Delivery % across every try</h3>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Share of all {data.shipped.toLocaleString("en-IN")} shipped orders delivered by each try (cumulative), alongside cumulative RTO.
                </p>
                <TrendLineChart
                  labels={data.attemptFunnel.map((f) => f.label)}
                  yMax={100}
                  series={[
                    { key: "cum", label: "Cumulative delivery %", color: "#10b981", values: data.attemptFunnel.map((f) => f.cumulativeDeliveryPct) },
                    { key: "inc", label: "Delivered on this try %", color: "#6366f1", values: data.attemptFunnel.map((f) => f.incrementalDeliveryPct), fill: false },
                    { key: "rto", label: "Cumulative RTO %", color: "#f43f5e", values: data.attemptFunnel.map((f) => f.cumulativeRtoPct), fill: false },
                  ]}
                />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {data.attemptFunnel.map((f) => (
                    <div key={f.attempt} className="rounded-lg border border-border bg-muted/20 p-2.5 text-[11px]">
                      <div className="font-semibold text-foreground">{f.label}</div>
                      <div className="text-muted-foreground">Delivered: <strong className="text-emerald-600 dark:text-emerald-400">{f.delivered.toLocaleString("en-IN")}</strong> ({f.incrementalDeliveryPct}%)</div>
                      <div className="text-muted-foreground">RTO: <strong className="text-rose-600 dark:text-rose-400">{f.rto.toLocaleString("en-IN")}</strong></div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">All {isRto ? "RTO" : "NDR"} reasons ({data.reasons.length})</h3>
                    <p className="text-[11px] text-muted-foreground">Click a reason to see the orders behind it.</p>
                  </div>
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reasons…" className="h-8 w-48 rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  {reasons.map((r, i) => (
                    <button
                      key={r.reason}
                      type="button"
                      onClick={() => setSelected(selected === r.reason ? null : r.reason)}
                      className={`group w-full rounded-lg border p-2.5 text-left transition ${selected === r.reason ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                    >
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="flex items-center gap-2 font-semibold text-foreground">
                          <span className="size-2.5 rounded-full" style={{ background: REASON_COLORS[i % REASON_COLORS.length] }} />
                          {r.reason}
                        </span>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <strong className="text-foreground">{r.count.toLocaleString("en-IN")}</strong> ({r.percent}%)
                          <ChevronRight size={12} className="transition group-hover:translate-x-0.5" />
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${(r.count / maxCount) * 100}%`, background: REASON_COLORS[i % REASON_COLORS.length] }} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 text-[10.5px] text-muted-foreground">
                        <span>1st try: {r.attempt1}</span><span>2nd try: {r.attempt2}</span><span>3rd+ try: {r.attempt3Plus}</span>
                        <span className="text-emerald-600 dark:text-emerald-400">Recovered: {r.delivered}</span>
                        <span className="text-rose-600 dark:text-rose-400">RTO: {r.rto}</span>
                      </div>
                    </button>
                  ))}
                  {reasons.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">No reasons found.</div>}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-bold text-foreground">
                  Orders {selected ? <>for “{selected}”</> : "(latest 400)"} — {orders.length}
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-muted/40 font-semibold text-muted-foreground">
                      <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Courier / AWB</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2 text-right">Tries</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr>
                    </thead>
                    <tbody>
                      {orders.slice(0, 150).map((o) => (
                        <tr key={String(o.id)} className="border-t border-border/60 hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono font-semibold">{o.channel_order_id || o.id}</td>
                          <td className="px-3 py-2">{o.customer_name || "—"}<div className="text-muted-foreground">{[o.customer_city, o.customer_state].filter(Boolean).join(", ")}</div></td>
                          <td className="px-3 py-2">{o.courier || "—"}<div className="font-mono text-muted-foreground">{o.awb || ""}</div></td>
                          <td className="px-3 py-2">{o.reason}</td>
                          <td className="px-3 py-2 text-right font-bold">{o.attempts}</td>
                          <td className="px-3 py-2">{o.status}</td>
                          <td className="px-3 py-2 text-right">
                            <button type="button" className="rounded-md border border-border px-2 py-1 font-semibold hover:bg-muted" onClick={() => onOpenOrderTimeline({ id: o.id, channelOrderId: o.channel_order_id, awb: o.awb })}>
                              Attempt history
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
