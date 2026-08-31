"use client";

import { useCallback, useEffect, useState } from "react";

type Change = { orderId: number; channelOrderId: string; fields: string[]; statusBefore?: string; statusAfter?: string };
type Report = {
  id: number; mode: string; source: string; checked: number; newOrders: number;
  changedOrders: number; unchangedOrders: number; discrepanciesTotal: number;
  ndrRecords: number; ndrEnriched: number; fields: Record<string, number>;
  changes: Change[]; createdAt: string;
};
type ReportsResponse = { reports: Report[]; total: number; page: number; totalPages: number; error?: string };

function formatDate(value: string) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export default function ReportsPanel({ active }: { active: boolean }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReports = useCallback(async () => {
    try {
      const response = await fetch("/api/reports?page=1", { cache: "no-store" });
      const payload = await response.json() as ReportsResponse;
      if (!response.ok) throw new Error(payload.error || "Could not load reports");
      setReports(payload.reports);
      setSelectedId((current) => current && payload.reports.some((report) => report.id === current) ? current : payload.reports[0]?.id ?? null);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void loadReports(), 0);
    return () => window.clearTimeout(timer);
  }, [active, loadReports]);
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => void loadReports(), 10000);
    return () => window.clearInterval(interval);
  }, [active, loadReports]);
  useEffect(() => {
    if (!active || !selectedId) return;
    const controller = new AbortController();
    fetch(`/api/reports?id=${selectedId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { report?: Report; error?: string };
        if (!response.ok || !payload.report) throw new Error(payload.error || "Could not load report");
        return payload.report;
      })
      .then(setSelected)
      .catch((loadError: Error) => { if (loadError.name !== "AbortError") setError(loadError.message); });
    return () => controller.abort();
  }, [active, selectedId]);

  return (
    <section className={`reports-view ${!active ? "view-hidden" : ""}`}>
      {error && <div className="report-error">{error}<button onClick={() => void loadReports()}>Retry</button></div>}
      <section className="reports-card">
        <header className="reports-heading">
          <div><p className="eyebrow">Saved reports</p><h2>Reconciliation history</h2><p>Every completed API sync is stored here. Open any row to inspect it or download its Excel workbook.</p></div>
          <span>{reports.length} recent reports</span>
        </header>
        <div className="report-table-wrap history-table">
          <table className="report-table">
            <thead><tr><th>Completed</th><th>Type</th><th>Checked</th><th>New</th><th>Changed</th><th>Unchanged</th><th>Discrepancies</th><th>NDR filled</th><th>Excel</th></tr></thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id} className={selectedId === report.id ? "active" : ""} onClick={() => setSelectedId(report.id)}>
                  <td><strong>{formatDate(report.createdAt)}</strong><small>Report #{report.id}</small></td>
                  <td><span className="report-kind">{report.mode}</span><small>{report.source}</small></td>
                  <td>{report.checked}</td><td>{report.newOrders}</td><td>{report.changedOrders}</td><td>{report.unchangedOrders}</td>
                  <td><strong>{report.discrepanciesTotal}</strong></td><td>{report.ndrEnriched} / {report.ndrRecords}</td>
                  <td><a className="report-download compact" href={`/api/reports?id=${report.id}&download=xlsx`} onClick={(event) => event.stopPropagation()}>Download</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && reports.length === 0 && <div className="reports-empty">No reports yet. Run a sync and its reconciliation report will appear here.</div>}
          {loading && reports.length === 0 && <div className="reports-empty">Loading saved reports…</div>}
        </div>
      </section>

      {selected && (
        <section className="reports-card report-detail-card">
          <header className="reports-heading">
            <div><p className="eyebrow">Report #{selected.id}</p><h2>Sync discrepancy table</h2><p>{formatDate(selected.createdAt)} · {selected.checked} orders checked · {selected.discrepanciesTotal} field discrepancies repaired</p></div>
            <a className="report-download" href={`/api/reports?id=${selected.id}&download=xlsx`}>↓ Download Excel</a>
          </header>
          <div className="report-detail-grid">
            <div>
              <h3>Discrepancies by field</h3>
              <div className="report-table-wrap compact-table"><table className="report-table"><thead><tr><th>Field</th><th>Count</th></tr></thead><tbody>{Object.entries(selected.fields).sort((left, right) => right[1] - left[1]).map(([field, count]) => <tr key={field}><td>{field}</td><td><strong>{count}</strong></td></tr>)}</tbody></table>{Object.keys(selected.fields).length === 0 && <div className="reports-empty small">No field discrepancies.</div>}</div>
            </div>
            <div>
              <h3>Affected orders</h3>
              <div className="report-table-wrap changes-table"><table className="report-table"><thead><tr><th>Order ID</th><th>Shiprocket ID</th><th>Fields changed</th><th>Status before</th><th>Status after</th></tr></thead><tbody>{selected.changes.map((change, index) => <tr key={`${change.orderId}-${index}`}><td><strong>{String(change.channelOrderId || change.orderId).replace(/^#+/, "")}</strong></td><td>{change.orderId}</td><td>{change.fields.join(", ")}</td><td>{change.statusBefore || "—"}</td><td>{change.statusAfter || "—"}</td></tr>)}</tbody></table>{selected.changes.length === 0 && <div className="reports-empty small">No existing orders needed correction.</div>}</div>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
