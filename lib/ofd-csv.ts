/**
 * Shiprocket CSV export parsing + per-day OFD reconstruction.
 *
 * The export keeps one row per SKU and only ONE "Latest OFD Date" per order, but it also
 * carries every NDR attempt date and the delivered date. Every attempt is an OFD day, so the
 * full OFD history of an order is: first OFD day, NDR 1/2/3 days, delivered day, latest OFD day.
 */
import { toIndiaDate } from "./ofd-attempt";

/** RFC-4180 parser: handles quoted fields containing commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else if (ch !== "\0") {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface CsvOfdOrder {
  channelOrderId: string;
  awb: string;
  status: string; // upper-cased current status
  firstOfdAt: string; // ISO with +05:30, or ""
  latestOfdDate: string; // YYYY-MM-DD or ""
  deliveredAt: string; // ISO with +05:30, or ""
  ndrDates: string[]; // YYYY-MM-DD, in attempt order
  ndrRemarks: string[];
  attemptCount: number;
  rtoInitiatedDate: string;
}

const clean = (v: string | undefined) => {
  const s = (v || "").trim();
  return s === "N/A" || s === "-" || s.toLowerCase() === "nan" ? "" : s;
};

/** "2026-10-11 14:40:46(.000)" (IST) -> "2026-10-11T14:40:46+05:30" */
export function csvTimestampToIso(value: string): string {
  const s = clean(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/);
  if (!m) return "";
  return `${m[1]}T${m[2] || "00:00:00"}+05:30`;
}

export function readOfdCsv(text: string): Map<string, CsvOfdOrder> {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("CSV is empty");
  const col = new Map<string, number>();
  table[0].forEach((h, i) => col.set(h.trim(), i));
  for (const required of ["Order ID", "Status", "Latest OFD Date", "Attempt Count"]) {
    if (!col.has(required)) throw new Error(`CSV is missing required column "${required}"`);
  }
  const orders = new Map<string, CsvOfdOrder>();
  for (let r = 1; r < table.length; r++) {
    const c = table[r];
    const get = (name: string) => clean(c[col.get(name) ?? -1]);
    const channelOrderId = get("Order ID");
    if (!channelOrderId || orders.has(channelOrderId)) continue; // one row per SKU; order-level fields identical
    const ndrDates: string[] = [];
    const ndrRemarks: string[] = [];
    for (const n of [1, 2, 3]) {
      const d = toIndiaDate(get(`NDR ${n} Attempt Date`));
      if (d) {
        ndrDates.push(d);
        ndrRemarks.push(get(`NDR ${n} Remark`));
      }
    }
    orders.set(channelOrderId, {
      channelOrderId,
      awb: get("AWB Code"),
      status: get("Status").toUpperCase(),
      firstOfdAt: csvTimestampToIso(get("First Out For Delivery Date")),
      latestOfdDate: toIndiaDate(get("Latest OFD Date")),
      deliveredAt: csvTimestampToIso(get("Order Delivered Date")),
      ndrDates,
      ndrRemarks,
      attemptCount: Number(get("Attempt Count") || 0),
      rtoInitiatedDate: toIndiaDate(get("RTO Initiated Date")),
    });
  }
  return orders;
}

/** Sorted distinct IST days on which this order was out for delivery. */
export function ofdDaysOf(o: CsvOfdOrder): string[] {
  const days = new Set<string>();
  const first = toIndiaDate(o.firstOfdAt);
  if (first) days.add(first);
  if (o.latestOfdDate) days.add(o.latestOfdDate);
  const delivered = toIndiaDate(o.deliveredAt);
  if (delivered) days.add(delivered);
  o.ndrDates.forEach((d) => days.add(d));
  return [...days].sort();
}

/** Attempt number of the n-th known OFD day, anchored on the CSV's own "Attempt Count". */
export function attemptNumberForDay(o: CsvOfdOrder, days: string[], day: string): number {
  const idx = days.indexOf(day);
  const total = o.attemptCount > 0 ? o.attemptCount : days.length;
  // The last known OFD day is attempt #total; earlier known days count down from it.
  const attempt = total - (days.length - 1 - idx);
  return Math.max(1, attempt);
}

/** Status of the order as of the close of `day` (never "currently out" for a passed day). */
export function statusForDay(o: CsvOfdOrder, day: string, today: string): string {
  if (toIndiaDate(o.deliveredAt) === day) return "DELIVERED";
  const isLatest = day === o.latestOfdDate || (!o.latestOfdDate && day === toIndiaDate(o.firstOfdAt));
  if (isLatest) {
    const s = o.status;
    if (s.startsWith("RTO")) return s;
    if (s === "DELIVERED") return "DELIVERED";
    if (s.startsWith("UNDELIVERED")) return "UNDELIVERED";
    if (day >= today) return s || "OUT FOR DELIVERY";
  }
  if (o.ndrDates.includes(day)) return "UNDELIVERED";
  return day < today ? "UNRESOLVED AFTER OFD" : "OUT FOR DELIVERY";
}
