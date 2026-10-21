"use client";

import React, { useCallback, useEffect, useState } from "react";
import { X, Loader2, Search, PhoneCall, PhoneMissed, CheckCircle2, XCircle, Download } from "lucide-react";

interface CallLog {
  id: number; orderId: number; channelOrderId?: string; customerName?: string; customerPhone?: string; total?: number;
  attemptNumber: number; outcome: string; note: string; rejectionReason?: string; callbackAt?: string; nextActionAt?: string;
  createdAt: string; actorId?: string; actorName?: string; actorRole?: string;
}

const OUTCOMES: Record<string, { label: string; cls: string; Icon: typeof PhoneCall }> = {
  confirmed: { label: "Confirmed", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", Icon: CheckCircle2 },
  rejected: { label: "Rejected", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300", Icon: XCircle },
  callback: { label: "Callback", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", Icon: PhoneCall },
  unreachable: { label: "No answer", cls: "bg-slate-500/15 text-slate-700 dark:text-slate-300", Icon: PhoneMissed },
};

const when = (v?: string) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
};

export function CallLogModal({ open, onClose, agents }: { open: boolean; onClose: () => void; agents: Array<{ userId: string; name: string }> }) {
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState("");
  const [agent, setAgent] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ section: "call_logs", limit: "500" });
      if (q.trim()) params.set("q", q.trim());
      if (outcome) params.set("outcome", outcome);
      if (agent) params.set("agent", agent);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/confirmation?${params}`, { cache: "no-store", signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load call log");
      setLogs(json.logs || []);
      setTotals(Object.fromEntries((json.totals || []).map((t: { outcome: string; count: number }) => [t.outcome, t.count])));
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : "Could not load call log");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [q, outcome, agent, from, to]);

  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    const t = window.setTimeout(() => void load(c.signal), q ? 300 : 0);
    return () => { window.clearTimeout(t); c.abort(); };
  }, [open, load, q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["When", "Order", "Customer", "Phone", "Agent", "Attempt", "Outcome", "Note", "Callback at", "Rejection reason"],
      ...logs.map((l) => [when(l.createdAt), l.channelOrderId, l.customerName, l.customerPhone, l.actorName, l.attemptNumber, l.outcome, l.note, when(l.callbackAt), l.rejectionReason])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `call-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!open) return null;
  const input = "h-8 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border bg-muted/20 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-foreground">Agent Call Log</h2>
            <p className="text-[11px] text-muted-foreground">Every confirmation call, note and callback recorded by your support agents.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={exportCsv} disabled={!logs.length} className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-40">
              <Download size={13} /> CSV
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><X size={16} /></button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className={`${input} w-56 pl-8`} placeholder="Note, order #, customer, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className={input} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">All outcomes</option>
            {Object.entries(OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className={input} value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">All agents</option>
            {agents.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}
          </select>
          <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <div className="ml-auto flex flex-wrap gap-1.5">
            {Object.entries(OUTCOMES).map(([k, v]) => (
              <span key={k} className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${v.cls}`}>{v.label}: {totals[k] || 0}</span>
            ))}
          </div>
        </div>

        <div className="overflow-auto">
          {loading && <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
          {error && <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>}
          {!loading && !error && logs.length === 0 && <div className="py-12 text-center text-xs text-muted-foreground">No call activity recorded for these filters yet.</div>}
          {logs.length > 0 && (
            <table className="w-full text-left text-[11.5px]">
              <thead className="sticky top-0 bg-muted/80 font-semibold text-muted-foreground backdrop-blur">
                <tr><th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Agent</th><th className="px-4 py-2.5">Try</th><th className="px-4 py-2.5">Outcome</th><th className="px-4 py-2.5">Note</th></tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const o = OUTCOMES[l.outcome] || { label: l.outcome, cls: "bg-muted text-foreground", Icon: PhoneCall };
                  return (
                    <tr key={l.id} className="border-t border-border/60 align-top hover:bg-muted/20">
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{when(l.createdAt)}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold">{l.channelOrderId || l.orderId}</td>
                      <td className="px-4 py-2.5">{l.customerName || "—"}<div className="text-muted-foreground">{l.customerPhone}</div></td>
                      <td className="px-4 py-2.5">{l.actorName || <span className="text-muted-foreground">Not recorded</span>}<div className="text-muted-foreground">{l.actorRole}</div></td>
                      <td className="px-4 py-2.5 font-bold">{l.attemptNumber}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${o.cls}`}><o.Icon size={11} />{o.label}</span>
                        {l.outcome === "callback" && l.callbackAt && <div className="mt-1 text-muted-foreground">Call back: {when(l.callbackAt)}</div>}
                        {l.rejectionReason && <div className="mt-1 text-muted-foreground">{l.rejectionReason.replaceAll("_", " ")}</div>}
                      </td>
                      <td className="max-w-md whitespace-pre-wrap px-4 py-2.5 text-foreground">{l.note || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
