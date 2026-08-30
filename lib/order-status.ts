export type OrderTab = "new" | "ready" | "shipped" | "delivered" | "rto" | "all";
export type OrderBucket = Exclude<OrderTab, "all"> | "other";

const NEW = new Set(["NEW", "NEW ORDER", "PENDING", "PENDING ORDER", "PROCESSING"]);
const READY = new Set(["READY TO SHIP", "AWB ASSIGNED", "PICKUP SCHEDULED", "MANIFEST GENERATED", "OUT FOR PICKUP", "PICKUP EXCEPTION"]);
const DELIVERED = new Set(["DELIVERED", "DELIVERED TO CUSTOMER"]);
const SHIPPED = new Set([
  "SHIPPED", "IN TRANSIT", "IN TRANSIT-EN-ROUTE", "IN TRANSIT-AT DESTINATION HUB",
  "REACHED AT DESTINATION HUB", "OUT FOR DELIVERY", "PICKED UP",
  "MISROUTED", "UNTRACEABLE", "UNDELIVERED", "NDR", "NDR PENDING",
]);

const normalized = (value: unknown) => String(value ?? "").trim().toUpperCase();

export function statusTab(statusValue: unknown): OrderBucket {
  const status = normalized(statusValue);
  if (status.startsWith("RTO") || status.includes("RETURN TO ORIGIN")) return "rto";
  if (DELIVERED.has(status)) return "delivered";
  if (READY.has(status)) return "ready";
  if (SHIPPED.has(status) || status.startsWith("UNDELIVERED")) return "shipped";
  if (NEW.has(status)) return "new";
  return "other";
}

export function sqlForTab(tab: OrderTab) {
  const s = "UPPER(TRIM(status))";
  if (tab === "rto") return `(${s} LIKE 'RTO%' OR ${s} LIKE '%RETURN TO ORIGIN%')`;
  if (tab === "delivered") return `${s} IN ('DELIVERED', 'DELIVERED TO CUSTOMER')`;
  if (tab === "ready") return `${s} IN ('READY TO SHIP', 'AWB ASSIGNED', 'PICKUP SCHEDULED', 'MANIFEST GENERATED', 'OUT FOR PICKUP', 'PICKUP EXCEPTION')`;
  if (tab === "shipped") return `(${s} IN (
    'SHIPPED', 'IN TRANSIT', 'IN TRANSIT-EN-ROUTE', 'IN TRANSIT-AT DESTINATION HUB',
    'REACHED AT DESTINATION HUB', 'OUT FOR DELIVERY', 'PICKED UP',
    'MISROUTED', 'UNTRACEABLE', 'UNDELIVERED', 'NDR', 'NDR PENDING'
  ) OR ${s} LIKE 'UNDELIVERED%')`;
  if (tab === "new") return `${s} IN ('NEW', 'NEW ORDER', 'PENDING', 'PENDING ORDER', 'PROCESSING')`;
  return "1 = 1";
}
