import { getRuntimeEnv, ensureSchema } from "@/lib/database";
import { getIndiaDate, generateOfdAuditCsv, syncTodayOfdAudit, ensureOfdAuditSchema, type OfdAuditRecord } from "@/lib/ofd-audit";
import { requireApiUser } from "@/lib/auth/access";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

function validateExportAccess(request: Request, webhookSecret: string): boolean {
  const url = new URL(request.url);
  const token =
    url.searchParams.get("token") ||
    url.searchParams.get("key") ||
    url.searchParams.get("api_key") ||
    request.headers.get("x-api-key") ||
    request.headers.get("x-export-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  // Allow matching with SHIPROCKET_WEBHOOK_SECRET or EXPORT_SECRET or SUPPORT_TOKEN_KEY
  if (webhookSecret && token.trim() === webhookSecret.trim()) return true;
  if (process.env.EXPORT_TOKEN && token.trim() === process.env.EXPORT_TOKEN.trim()) return true;
  if (process.env.SUPPORT_TOKEN_KEY && token.trim() === process.env.SUPPORT_TOKEN_KEY.trim()) return true;

  return false;
}

export async function GET(request: Request) {
  try {
    const runtime = getRuntimeEnv();
    await ensureSchema(runtime.DB);
    await ensureOfdAuditSchema(runtime.DB);

    const secret = runtime.SHIPROCKET_WEBHOOK_SECRET || "";
    const isTokenAuthed = validateExportAccess(request, secret);

    // If not token-authenticated, verify logged-in user session
    if (!isTokenAuthed) {
      const access = await requireApiUser();
      if (access.response) return access.response;
    }

    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");
    const targetDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : getIndiaDate();
    const format = url.searchParams.get("format") || "csv";

    // Refresh audit table with latest data before export
    await syncTodayOfdAudit(runtime.DB, targetDate);

    if (format === "json") {
      const records = await runtime.DB.prepare(`
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

      return Response.json({
        date: targetDate,
        count: records.results.length,
        records: records.results,
      });
    }

    // Default CSV output (compatible with Google Sheets =IMPORTDATA(...) and Excel)
    const csvContent = await generateOfdAuditCsv(runtime.DB, targetDate);

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="satmi-today-ofd-${targetDate}.csv"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    },
  });
}
