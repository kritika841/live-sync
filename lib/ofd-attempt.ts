/**
 * Logic for calculating and tracking delivery attempt cohorts (1st, 2nd, 3rd attempt),
 * delivery success rates by attempt, and cohort rollover transitions.
 */

export interface OfdOrderLike {
  id: string | number;
  channelOrderId?: string;
  status?: string;
  outForDeliveryAt?: string;
  firstOutForDeliveryAt?: string;
  deliveredAt?: string;
  ndrAttempts?: number;
  ndr_attempts?: number;
  ndrReason?: string;
  ndrRaisedAt?: string;
  attemptNumber?: number;
  attempt_number?: number;
  attemptCount?: number;
}

export interface AttemptCohortMetrics {
  total: {
    count: number;
    delivered: number;
    deliveredPercent: number;
    undelivered: number;
    stillOut: number;
    rto: number;
    unresolved: number;
  };
  firstAttempt: {
    count: number;
    percent: number;
    delivered: number;
    deliveredPercent: number;
    undelivered: number;
    stillOut: number;
    rto: number;
  };
  secondAttempt: {
    count: number;
    percent: number;
    delivered: number;
    deliveredPercent: number;
    undelivered: number;
    stillOut: number;
    rto: number;
  };
  thirdAttempt: {
    count: number;
    percent: number;
    delivered: number;
    deliveredPercent: number;
    undelivered: number;
    stillOut: number;
    rto: number;
  };
  laterAttempt: {
    count: number;
    percent: number;
    delivered: number;
    deliveredPercent: number;
    undelivered: number;
    stillOut: number;
    rto: number;
  };
  cohortFlow: {
    freshOrders: number;
    reattemptOrders: number;
    attempt2EligibleFromToday: number;
    attempt3EligibleFromToday: number;
    rtoFromToday: number;
  };
}

/**
 * Converts a timestamp string to its Asia/Kolkata calendar date (YYYY-MM-DD).
 * ISO strings carrying a timezone (Z / +hh:mm) are converted; anything else is
 * assumed to already be a local date/time and is sliced.
 */
export function toIndiaDate(value: unknown): string {
  const source = String(value || "").trim();
  if (!source) return "";
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(source)) {
    const parsed = new Date(source);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(parsed);
    }
  }
  return source.slice(0, 10);
}

const OPEN_DELIVERY_STATUSES = [
  "SHIPPED",
  "IN TRANSIT",
  "IN TRANSIT-EN-ROUTE",
  "IN TRANSIT-AT DESTINATION HUB",
  "REACHED AT DESTINATION HUB",
  "REACHED DESTINATION HUB",
  "PICKED UP",
  "MISROUTED",
  "UNTRACEABLE",
  "OUT FOR DELIVERY",
];

export function isOpenDeliveryStatus(statusValue: unknown): boolean {
  return OPEN_DELIVERY_STATUSES.includes(String(statusValue || "").trim().toUpperCase());
}

/**
 * Single source of truth for the status shown for an OFD row on `selectedDate`.
 * Used by both the Today's OFD tab and the Analytics overview card.
 */
export function normalizeOfdStatus(
  row: { status?: unknown; latestKnownStatus?: unknown; deliveredAt?: unknown; ndrRaisedAt?: unknown },
  selectedDate: string,
  currentIndiaDate: string
): string {
  let status = String(row.status || "").trim();
  if (!status && row.latestKnownStatus) {
    status = String(row.latestKnownStatus).trim();
  }
  if ((!status || isOpenDeliveryStatus(status)) && toIndiaDate(row.deliveredAt) === selectedDate) {
    status = "DELIVERED";
  }
  if (!status && toIndiaDate(row.ndrRaisedAt) === selectedDate) {
    status = "UNDELIVERED";
  }
  if (!status) {
    status = selectedDate === currentIndiaDate ? "OUT FOR DELIVERY" : "UNRESOLVED AFTER OFD";
  }
  if (selectedDate < currentIndiaDate && isOpenDeliveryStatus(status)) {
    status = "UNRESOLVED AFTER OFD";
  }
  return status;
}

/**
 * Derives the correct attempt number (1, 2, 3, 4+) for an order on a given targetDate.
 */
export function deriveOrderAttemptNumber(
  order: OfdOrderLike,
  targetDate: string,
  priorRecordedOfdDatesCount: number = 0
): number {
  const status = String(order.status || "").trim().toUpperCase();
  const ndrAttempts = Number(order.ndrAttempts || order.ndr_attempts || 0);
  const firstOfdDate = toIndiaDate(order.firstOutForDeliveryAt);
  const latestOfdDate = toIndiaDate(order.outForDeliveryAt);
  const explicitCount = Number(order.attemptCount || 0);

  // 1. Explicit status string indicators from courier / Shiprocket
  if (status.includes("4TH ATTEMPT") || status.includes("4TH_ATTEMPT")) return 4;
  if (status.includes("3RD ATTEMPT") || status.includes("3RD_ATTEMPT")) return 3;
  if (status.includes("2ND ATTEMPT") || status.includes("2ND_ATTEMPT")) return 2;
  if (status.includes("1ST ATTEMPT") || status.includes("1ST_ATTEMPT")) return 1;

  // 2. Count of distinct prior OFD days recorded in ledger / audit / webhook history
  // If an order had 1 prior OFD day before targetDate, today is Attempt 2
  if (priorRecordedOfdDatesCount > 0) {
    return Math.min(4, Math.max(2, priorRecordedOfdDatesCount + 1));
  }

  // 3. Failed delivery (NDR) attempts prior to this run
  if (ndrAttempts >= 3) return 4;
  if (ndrAttempts === 2) return 3;
  if (ndrAttempts === 1) return 2;

  // 4. Date comparison: If first OFD date was on a calendar day before targetDate,
  // this is a re-attempt (at least attempt 2)
  if (firstOfdDate && firstOfdDate < targetDate) {
    if (latestOfdDate && latestOfdDate > firstOfdDate && latestOfdDate < targetDate) {
      return 3;
    }
    return 2;
  }

  // 5. If Shiprocket explicitly recorded attempt count > 1
  if (explicitCount > 1) return Math.min(4, explicitCount);

  // 6. Existing recorded attempt number if > 1
  const existingAtt = Number(order.attemptNumber || order.attempt_number || 0);
  if (existingAtt > 1) return existingAtt;

  return 1;
}

/**
 * Calculates comprehensive attempt cohort metrics and rollover flow for a list of orders.
 */
export function calculateCohortMetrics(
  orders: Array<Record<string, unknown>>,
  selectedDate: string,
  todayStr: string
): AttemptCohortMetrics {
  const isPast = selectedDate < todayStr;
  let totalDel = 0;
  let totalUndel = 0;
  let totalStill = 0;
  let totalRto = 0;
  let totalUnresolved = 0;

  const cohorts = {
    1: { count: 0, del: 0, undel: 0, still: 0, rto: 0 },
    2: { count: 0, del: 0, undel: 0, still: 0, rto: 0 },
    3: { count: 0, del: 0, undel: 0, still: 0, rto: 0 },
    4: { count: 0, del: 0, undel: 0, still: 0, rto: 0 },
  };

  for (const o of orders) {
    const att = Math.min(Math.max(1, Number(o.attemptNumber || 1)), 4) as 1 | 2 | 3 | 4;
    cohorts[att].count++;

    const status = String(o.status || "").trim().toUpperCase();
    const deliveredAt = toIndiaDate(o.deliveredAt);
    const isDelivered = !status.includes("UNDELIVERED") && !status.includes("RTO") && /DELIVERED/.test(status) && (deliveredAt <= selectedDate || !deliveredAt);
    const isRto = /RTO/.test(status) || status.includes("RETURN TO ORIGIN");
    const isStillOut = status === "OUT FOR DELIVERY";
    const isUnresolved = status === "UNRESOLVED AFTER OFD";
    const isUndelivered = !isDelivered && !isRto && !isStillOut && !isUnresolved;

    if (isDelivered) {
      cohorts[att].del++;
      totalDel++;
    } else if (isRto) {
      cohorts[att].rto++;
      totalRto++;
    } else if (isStillOut) {
      if (isPast) {
        cohorts[att].undel++;
        totalUndel++;
      } else {
        cohorts[att].still++;
        totalStill++;
      }
    } else if (isUnresolved) {
      cohorts[att].undel++;
      totalUnresolved++;
      totalUndel++;
    } else {
      cohorts[att].undel++;
      totalUndel++;
    }
  }

  const totalCount = orders.length || 1;
  const pct = (val: number, base: number) => (base > 0 ? Math.round((val / base) * 1000) / 10 : 0);

  return {
    total: {
      count: orders.length,
      delivered: totalDel,
      deliveredPercent: pct(totalDel, orders.length),
      undelivered: totalUndel,
      stillOut: totalStill,
      rto: totalRto,
      unresolved: totalUnresolved,
    },
    firstAttempt: {
      count: cohorts[1].count,
      percent: pct(cohorts[1].count, orders.length),
      delivered: cohorts[1].del,
      deliveredPercent: pct(cohorts[1].del, cohorts[1].count),
      undelivered: cohorts[1].undel,
      stillOut: cohorts[1].still,
      rto: cohorts[1].rto,
    },
    secondAttempt: {
      count: cohorts[2].count,
      percent: pct(cohorts[2].count, orders.length),
      delivered: cohorts[2].del,
      deliveredPercent: pct(cohorts[2].del, cohorts[2].count),
      undelivered: cohorts[2].undel,
      stillOut: cohorts[2].still,
      rto: cohorts[2].rto,
    },
    thirdAttempt: {
      count: cohorts[3].count,
      percent: pct(cohorts[3].count, orders.length),
      delivered: cohorts[3].del,
      deliveredPercent: pct(cohorts[3].del, cohorts[3].count),
      undelivered: cohorts[3].undel,
      stillOut: cohorts[3].still,
      rto: cohorts[3].rto,
    },
    laterAttempt: {
      count: cohorts[4].count,
      percent: pct(cohorts[4].count, orders.length),
      delivered: cohorts[4].del,
      deliveredPercent: pct(cohorts[4].del, cohorts[4].count),
      undelivered: cohorts[4].undel,
      stillOut: cohorts[4].still,
      rto: cohorts[4].rto,
    },
    cohortFlow: {
      freshOrders: cohorts[1].count,
      reattemptOrders: cohorts[2].count + cohorts[3].count + cohorts[4].count,
      attempt2EligibleFromToday: cohorts[1].undel + cohorts[1].still,
      attempt3EligibleFromToday: cohorts[2].undel + cohorts[2].still,
      rtoFromToday: totalRto,
    },
  };
}
