import { withRequestDatabase } from "../../../lib/database";
import { errorResponse as requestErrorResponse } from "../../../lib/http";
import { loadOfdRecords } from "../../../lib/ofd";
import { errorResponse } from "../../../lib/http";
import { requireApiUser } from "../../../lib/auth/access";
import { ensureSchema, getRuntimeEnv } from "../../../lib/database";


export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
import {analyticsOverview,metric} from "../../../lib/analytics-overview";
function indiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function statusBucket(statusValue: unknown) {
  const status = String(statusValue || "").trim().toUpperCase();
  if (status === "UNRESOLVED AFTER OFD") return "unresolved" as const;
  if (status === "DELIVERED" || status === "DELIVERED TO CUSTOMER") return "delivered" as const;
  if (status.startsWith("RTO") || status.includes("RETURN TO ORIGIN")) return "rto" as const;
  if (status === "UNDELIVERED" || status === "NDR" || status === "NDR PENDING" || status.startsWith("UNDELIVERED")) return "undelivered" as const;
  if (status === "OUT FOR DELIVERY") return "stillOut" as const;
  return "other" as const;
}

function isOpenDeliveryStatus(statusValue: unknown) {
  const status = String(statusValue || "").trim().toUpperCase();
  return ["SHIPPED", "IN TRANSIT", "IN TRANSIT-EN-ROUTE", "IN TRANSIT-AT DESTINATION HUB", "REACHED AT DESTINATION HUB", "REACHED DESTINATION HUB", "PICKED UP", "MISROUTED", "UNTRACEABLE", "OUT FOR DELIVERY"].includes(status);
}

function indiaDateFromValue(value: unknown) {
  const source = String(value || "");
  if (!source) return "";
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return source.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

async function handleGET(request: Request) {
  const access = await requireApiUser();
  if (access.response) return access.response;
  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "today_ofd" ? "today_ofd" : "overview";

  if (mode === "today_ofd") {
    const currentIndiaDate = indiaToday();
    const requestedDate = url.searchParams.get("date") || currentIndiaDate;
    const selectedDate = isoDate.test(requestedDate) && requestedDate <= currentIndiaDate ? requestedDate : currentIndiaDate;
    const history = await runtime.DB.prepare("SELECT key,value FROM sync_state WHERE key IN ('tracking_history_status','tracking_history_last_sync_at')").all<{key:string;value:string}>();
    const historyState = Object.fromEntries(history.results.map(r=>[r.key,r.value]));
    const trackingHistory = {status:historyState.tracking_history_status || "pending",lastSyncAt:historyState.tracking_history_last_sync_at || "",cached:true};
    const rows = await loadOfdRecords(runtime.DB,selectedDate);
    const orders: Array<Record<string, unknown> & { attemptNumber: number; previousUndelivered: boolean }> = rows.results.map((row) => {
      let status = String(row.latestKnownStatus || "");
      if ((!status || isOpenDeliveryStatus(status)) && indiaDateFromValue(row.deliveredAt) === selectedDate) status = "DELIVERED";
      if (!status && indiaDateFromValue(row.ndrRaisedAt) === selectedDate) status = "UNDELIVERED";
      if (!status) status = selectedDate === currentIndiaDate ? String(row.status || "") : "UNRESOLVED AFTER OFD";
      if (selectedDate < currentIndiaDate && isOpenDeliveryStatus(status)) status = "UNRESOLVED AFTER OFD";
      return {
        ...row, status, latestKnownStatus: undefined,
        attemptNumber: Number(row.attemptNumber || 0),
        attemptBasis: "recorded_ofd_days",
        previousUndelivered: Boolean(row.previousUndelivered),
      };
    });
    const total = orders.length;
    const bucketCounts = { delivered: 0, undelivered: 0, stillOut: 0, unresolved: 0, rto: 0, other: 0 };
    const attemptCounts = { first: 0, second: 0, third: 0, later: 0, unknown: 0 };
    for (const order of orders) {
      const bucket = statusBucket(order.status);
      bucketCounts[bucket] += 1;
      const attempt = Number(order.attemptNumber);
      if (!attempt) attemptCounts.unknown += 1;
      else if (attempt === 1) attemptCounts.first += 1;
      else if (attempt === 2) attemptCounts.second += 1;
      else if (attempt === 3) attemptCounts.third += 1;
      else attemptCounts.later += 1;
    }
    const previousUndelivered = orders.filter((order) => order.previousUndelivered).length;
    return Response.json({
      date: selectedDate,
      metrics: {
        total: metric(total, total), delivered: metric(bucketCounts.delivered, total),
        undelivered: metric(bucketCounts.undelivered, total), stillOut: metric(bucketCounts.stillOut, total),
        unresolved: metric(bucketCounts.unresolved, total),
        firstAttemptOFD: metric(attemptCounts.first, total), secondAttemptOFD: metric(attemptCounts.second, total),
        unknownAttemptOFD: metric(attemptCounts.unknown, total),
        thirdAttemptOFD: metric(attemptCounts.third, total), laterAttemptOFD: metric(attemptCounts.later, total),
        previousUndelivered: metric(previousUndelivered, total), rto: metric(bucketCounts.rto, total),
        other: metric(bucketCounts.other, total),
      },
      attemptBasis: "Recorded OFD days; courier attempt ordinals are not verified",
      trackingHistory,
      orders,
    });
  }

  return analyticsOverview(runtime,url);
}


async function GETHandler(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }

export async function GET(...args: Parameters<typeof GETHandler>) {
  try { return await withRequestDatabase(() => GETHandler(...args), 20000); }
  catch (error) { return requestErrorResponse(error); }
}
