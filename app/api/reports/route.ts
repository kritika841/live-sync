import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureSchema, getRuntimeEnv } from "../../../lib/database";
import { buildSyncReportWorkbook, type StoredSyncReport } from "../../../lib/excel-report";

export const dynamic = "force-dynamic";

type ReportRow = Omit<StoredSyncReport, "fields" | "changes"> & {
  fieldsJson: string;
  changesJson: string;
};

function normalizeReport(row: ReportRow): StoredSyncReport {
  let fields: Record<string, number> = {};
  let changes: StoredSyncReport["changes"] = [];
  try { fields = JSON.parse(row.fieldsJson || "{}"); } catch { fields = {}; }
  try { changes = JSON.parse(row.changesJson || "[]"); } catch { changes = []; }
  const { fieldsJson: _fieldsJson, changesJson: _changesJson, ...report } = row;
  void _fieldsJson; void _changesJson;
  return { ...report, fields, changes };
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" && !(await getChatGPTUser())) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  const runtime = getRuntimeEnv();
  await ensureSchema(runtime.DB);
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id") || 0);

  if (id > 0) {
    const row = await runtime.DB.prepare(`
      SELECT id, mode, source, checked, new_orders AS newOrders,
        changed_orders AS changedOrders, unchanged_orders AS unchangedOrders,
        discrepancies_total AS discrepanciesTotal, ndr_records AS ndrRecords,
        ndr_enriched AS ndrEnriched, fields_json AS fieldsJson,
        changes_json AS changesJson, created_at AS createdAt
      FROM sync_reports WHERE id = ? LIMIT 1
    `).bind(id).first<ReportRow>();
    if (!row) return Response.json({ error: "Report not found" }, { status: 404 });
    const report = normalizeReport(row);

    if (url.searchParams.get("download") === "xlsx") {
      const workbook = buildSyncReportWorkbook(report);
      const date = report.createdAt.slice(0, 10) || "sync";
      return new Response(workbook, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="satmi-sync-report-${date}-${report.id}.xlsx"`,
          "cache-control": "no-store",
        },
      });
    }
    return Response.json({ report }, { headers: { "cache-control": "no-store" } });
  }

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = 50;
  const offset = (page - 1) * perPage;
  const [rows, countRow] = await Promise.all([
    runtime.DB.prepare(`
      SELECT id, mode, source, checked, new_orders AS newOrders,
        changed_orders AS changedOrders, unchanged_orders AS unchangedOrders,
        discrepancies_total AS discrepanciesTotal, ndr_records AS ndrRecords,
        ndr_enriched AS ndrEnriched, fields_json AS fieldsJson,
        changes_json AS changesJson, created_at AS createdAt
      FROM sync_reports ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `).bind(perPage, offset).all<ReportRow>(),
    runtime.DB.prepare("SELECT COUNT(*) AS total FROM sync_reports").first<{ total: number }>(),
  ]);
  const total = Number(countRow?.total || 0);
  return Response.json({
    reports: rows.results.map(normalizeReport),
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  }, { headers: { "cache-control": "no-store" } });
}
