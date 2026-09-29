import { getRuntimeEnv, ensureSchema, logActivity } from "@/lib/database";
import { getIndiaDate, syncTodayOfdAudit, ensureOfdAuditSchema, type OfdAuditRecord } from "@/lib/ofd-audit";
import { requireApiUser } from "@/lib/auth/access";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const access = await requireApiUser();
    if (access.response) return access.response;

    const runtime = getRuntimeEnv();
    await ensureSchema(runtime.DB);
    await ensureOfdAuditSchema(runtime.DB);

    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");
    const targetDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : getIndiaDate();
    const forceRefresh = url.searchParams.get("refresh") === "1";

    if (forceRefresh) {
      await syncTodayOfdAudit(runtime.DB, targetDate);
    }

    const rows = await runtime.DB.prepare(`
      SELECT * FROM today_ofd_audit
      WHERE ofd_date = ?
      ORDER BY 
        CASE delivery_outcome
          WHEN 'delivered' THEN 1
          WHEN 'still_ofd' THEN 2
          WHEN 'undelivered' THEN 3
          WHEN 'rto' THEN 4
          ELSE 5
        END,
        id DESC
    `).bind(targetDate).all<OfdAuditRecord>();

    const records = rows.results || [];

    const summary = {
      total: records.length,
      delivered: records.filter((r) => r.deliveryOutcome === "delivered").length,
      stillOfd: records.filter((r) => r.deliveryOutcome === "still_ofd").length,
      undelivered: records.filter((r) => r.deliveryOutcome === "undelivered").length,
      rto: records.filter((r) => r.deliveryOutcome === "rto").length,
      verified: records.filter((r) => r.verifiedStatus === "verified").length,
      discrepant: records.filter((r) => r.verifiedStatus === "discrepant").length,
      totalWebhooks: records.reduce((acc, r) => acc + (Number(r.webhookCount) || 0), 0),
    };

    return Response.json({
      date: targetDate,
      summary,
      records,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireApiUser();
    if (access.response) return access.response;

    const runtime = getRuntimeEnv();
    await ensureSchema(runtime.DB);
    await ensureOfdAuditSchema(runtime.DB);

    const body = await request.json().catch(() => null) as {
      orderId?: string | number;
      date?: string;
      verifiedStatus?: "pending" | "verified" | "discrepant";
      notes?: string;
    } | null;

    if (!body?.orderId) {
      return Response.json({ error: "Missing orderId" }, { status: 400 });
    }

    const targetDate = body.date || getIndiaDate();
    const verifiedStatus = body.verifiedStatus || "verified";
    const notes = typeof body.notes === "string" ? body.notes : "";
    const now = new Date().toISOString();
    const actorEmail = access.user?.email || "user";

    await runtime.DB.prepare(`
      UPDATE today_ofd_audit SET
        verified_status = ?,
        verified_by = ?,
        verified_at = ?,
        notes = CASE WHEN ? != '' THEN ? ELSE notes END,
        updated_at = ?
      WHERE ofd_date = ? AND order_id = ?
    `).bind(
      verifiedStatus,
      actorEmail,
      now,
      notes,
      notes,
      now,
      targetDate,
      body.orderId
    ).run();

    await logActivity(
      runtime.DB,
      "OFD Audit",
      "ofd.audit.verified",
      `Order ${body.orderId} marked as ${verifiedStatus} by ${actorEmail}`,
      { orderId: body.orderId, date: targetDate, verifiedStatus, notes }
    );

    return Response.json({ success: true, verifiedStatus, verifiedAt: now });
  } catch (error) {
    return errorResponse(error);
  }
}
