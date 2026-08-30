export type OrderTab = "new" | "ready" | "shipped" | "delivered" | "rto" | "all";

export function statusTab(statusValue: unknown): OrderTab {
  const status = String(statusValue ?? "").trim().toLowerCase();
  if (status.includes("rto") || status.includes("return to origin")) return "rto";
  if (status.includes("delivered")) return "delivered";
  if (status.includes("ready to ship") || status.includes("awb assigned") || status.includes("pickup scheduled") || status.includes("manifest")) return "ready";
  if (status.includes("ship") || status.includes("transit") || status.includes("picked") || status.includes("pickup") || status.includes("out for delivery") || status.includes("undelivered") || status.includes("ndr")) return "shipped";
  return "new";
}

export function sqlForTab(tab: OrderTab) {
  const s = "LOWER(status)";
  if (tab === "rto") return `(${s} LIKE '%rto%' OR ${s} LIKE '%return to origin%')`;
  if (tab === "delivered") return `(${s} LIKE '%delivered%' AND ${s} NOT LIKE '%rto%' AND ${s} NOT LIKE '%return to origin%')`;
  if (tab === "ready") return `(${s} LIKE '%ready to ship%' OR ${s} LIKE '%awb assigned%' OR ${s} LIKE '%pickup scheduled%' OR ${s} LIKE '%manifest%')`;
  if (tab === "shipped") return `(${s} NOT LIKE '%rto%' AND ${s} NOT LIKE '%delivered%' AND (${s} LIKE '%ship%' OR ${s} LIKE '%transit%' OR ${s} LIKE '%picked%' OR ${s} LIKE '%pickup%' OR ${s} LIKE '%out for delivery%' OR ${s} LIKE '%undelivered%' OR ${s} LIKE '%ndr%'))`;
  if (tab === "new") return `(${s} NOT LIKE '%rto%' AND ${s} NOT LIKE '%delivered%' AND ${s} NOT LIKE '%ready to ship%' AND ${s} NOT LIKE '%awb assigned%' AND ${s} NOT LIKE '%pickup scheduled%' AND ${s} NOT LIKE '%manifest%' AND ${s} NOT LIKE '%ship%' AND ${s} NOT LIKE '%transit%' AND ${s} NOT LIKE '%picked%' AND ${s} NOT LIKE '%out for delivery%' AND ${s} NOT LIKE '%undelivered%' AND ${s} NOT LIKE '%ndr%')`;
  return "1 = 1";
}
