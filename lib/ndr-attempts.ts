/**
 * Helper to parse and extract multi-attempt delivery history and NDR reasons
 * from courier tracking scans, webhook events, and order metadata.
 */

export interface DeliveryAttemptRecord {
  attemptNumber: number;
  date: string;
  ofdTime?: string;
  failedAt?: string;
  deliveredAt?: string;
  status: "OUT FOR DELIVERY" | "UNDELIVERED" | "DELIVERED" | "RTO" | "IN TRANSIT";
  reason: string;
  reasonCode?: string;
  courierStatus?: string;
  location?: string;
}

export function parseDeliveryAttempts(
  order: {
    id?: number | string;
    channelOrderId?: string;
    status?: string;
    ndr_reason?: string;
    ndrReason?: string;
    ndr_attempts?: number;
    ndrAttempts?: number;
    ndr_raised_at?: string;
    ndrRaisedAt?: string;
    first_out_for_delivery_at?: string;
    firstOutForDeliveryAt?: string;
    out_for_delivery_at?: string;
    outForDeliveryAt?: string;
    delivered_at?: string;
    deliveredAt?: string;
  },
  webhookEvents: Array<{
    status?: string;
    event_at?: string;
    eventAt?: string;
    received_at?: string;
    receivedAt?: string;
    payload_json?: string;
    payload?: unknown;
  }> = []
): DeliveryAttemptRecord[] {
  const scans: Array<{
    date: string;
    status?: string;
    activity?: string;
    "sr-status-label"?: string;
    location?: string;
    reason?: string;
    reasonCode?: string;
  }> = [];

  for (const ev of webhookEvents) {
    let payload: Record<string, unknown> | null = null;
    if (ev.payload && typeof ev.payload === "object") {
      payload = ev.payload as Record<string, unknown>;
    } else if (ev.payload_json) {
      try {
        payload = JSON.parse(ev.payload_json);
      } catch {
        payload = null;
      }
    }

    if (payload) {
      if (Array.isArray(payload.scans)) {
        for (const s of payload.scans) {
          if (s && typeof s === "object") {
            scans.push({
              date: String(s.date || ""),
              status: String(s.status || ""),
              activity: String(s.activity || ""),
              "sr-status-label": String(s["sr-status-label"] || ""),
              location: String(s.location || ""),
              reason: String(s.reason || payload.undelivered_reason || ""),
              reasonCode: String(s.undelivered_reason_code || payload.undelivered_reason_code || ""),
            });
          }
        }
      } else if (payload.activity || payload.current_status || payload.undelivered_reason) {
        scans.push({
          date: String(ev.event_at || ev.eventAt || ev.received_at || ev.receivedAt || ""),
          status: String(ev.status || payload.current_status || ""),
          activity: String(payload.activity || payload.current_status || ""),
          "sr-status-label": String(ev.status || payload.current_status || ""),
          location: String(payload.location || ""),
          reason: String(payload.undelivered_reason || payload.reason || ""),
          reasonCode: String(payload.undelivered_reason_code || ""),
        });
      }
    }
  }

  // Deduplicate and sort chronologically
  const seen = new Set<string>();
  const sortedScans = scans
    .filter((s) => {
      if (!s.date || !s.activity) return false;
      const key = `${s.date}|${s.activity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const attemptsByDate = new Map<string, DeliveryAttemptRecord>();

  for (const scan of sortedScans) {
    const day = scan.date.slice(0, 10);
    const label = String(scan["sr-status-label"] || scan.status || "").toUpperCase();
    const act = String(scan.activity || "").toLowerCase();

    const isUndelivered =
      label.includes("UNDELIVERED") ||
      act.includes("undelivered") ||
      act.includes("refused") ||
      act.includes("unreachable") ||
      act.includes("not available") ||
      act.includes("unavailable") ||
      act.includes("cancellation") ||
      act.includes("door lock") ||
      act.includes("incomplete address") ||
      act.includes("wrong address");

    const isDelivered =
      !isUndelivered &&
      (label.includes("DELIVERED") || act.includes("delivered to customer") || act.includes("shipment delivered"));

    const isOfd =
      !isDelivered &&
      (label.includes("OUT FOR DELIVERY") || act.includes("out for delivery") || act.includes("dispatched for delivery"));

    if (!attemptsByDate.has(day) && (isOfd || isUndelivered || isDelivered)) {
      attemptsByDate.set(day, {
        attemptNumber: 1,
        date: day,
        ofdTime: isOfd ? scan.date : undefined,
        status: isDelivered ? "DELIVERED" : isUndelivered ? "UNDELIVERED" : "OUT FOR DELIVERY",
        reason: isUndelivered ? (scan.reason || scan.activity || "") : "",
        reasonCode: scan.reasonCode,
        courierStatus: scan.status || scan["sr-status-label"],
        location: scan.location,
      });
    }

    const current = attemptsByDate.get(day);
    if (current) {
      if (isOfd && !current.ofdTime) current.ofdTime = scan.date;
      if (isUndelivered) {
        current.status = "UNDELIVERED";
        current.reason = scan.reason || scan.activity || current.reason;
        if (scan.reasonCode) current.reasonCode = scan.reasonCode;
        current.failedAt = scan.date;
      }
      if (isDelivered) {
        current.status = "DELIVERED";
        current.deliveredAt = scan.date;
      }
      if (scan.location && !current.location) current.location = scan.location;
    }
  }

  const results = Array.from(attemptsByDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((att, idx) => ({
      ...att,
      attemptNumber: idx + 1,
    }));

  const globalReason = order.ndrReason || order.ndr_reason || "";
  const globalAttempts = Number(order.ndrAttempts || order.ndr_attempts || 0);

  // If no granular scans found but order has NDR reason or attempts, fallback gracefully
  if (results.length === 0 && (globalReason || globalAttempts > 0)) {
    const firstOfd = order.firstOutForDeliveryAt || order.first_out_for_delivery_at || "";
    const latestOfd = order.outForDeliveryAt || order.out_for_delivery_at || "";
    const raisedAt = order.ndrRaisedAt || order.ndr_raised_at || "";

    const totalAttempts = Math.max(1, globalAttempts);
    for (let i = 1; i <= totalAttempts; i++) {
      results.push({
        attemptNumber: i,
        date: (i === 1 ? firstOfd : latestOfd || raisedAt || "").slice(0, 10),
        ofdTime: i === 1 ? firstOfd : latestOfd,
        failedAt: i === totalAttempts ? raisedAt : undefined,
        status: i === totalAttempts && globalReason ? "UNDELIVERED" : "OUT FOR DELIVERY",
        reason: i === totalAttempts ? globalReason : (i > 1 ? "Delivery re-attempted" : "First delivery attempt"),
      });
    }
  }

  // Ensure last undelivered attempt has reason if missing
  if (results.length > 0 && globalReason) {
    const last = results[results.length - 1];
    if (last.status === "UNDELIVERED" && !last.reason) {
      last.reason = globalReason;
    }
  }

  return results;
}
