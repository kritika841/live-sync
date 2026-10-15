import { getRuntimeEnv, logActivity, setSyncState } from "./database";
import { getShiprocketToken, API_ROOT } from "./shiprocket";
import { reconcileSourceOfTruth } from "../scripts/reconcile-source-of-truth";
import { invalidateCache } from "./server-cache";
import { syncTodayOfdAudit } from "./ofd-audit";

export interface NightlyReconcileResult {
  success: boolean;
  timestamp: string;
  reportExportTriggered: boolean;
  csvReconciled: boolean;
  ordersUpdated: number;
  message: string;
  error?: string;
}

/**
 * Programmatically triggers Shiprocket's automated order export API.
 * Shiprocket compiles the full order report in the cloud and sends/generates the CSV.
 */
export async function triggerShiprocketExport(): Promise<{ success: boolean; message: string }> {
  try {
    const runtime = getRuntimeEnv();
    const token = await getShiprocketToken(runtime);

    const res = await fetch(`${API_ROOT}/orders/export`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, message: `Shiprocket export API returned status ${res.status}: ${errText}` };
    }

    const data = await res.json().catch(() => null);
    return {
      success: true,
      message: data?.message || "Shiprocket orders export successfully initiated in cloud.",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Master automated nightly reconciliation worker.
 * Runs 100% autonomously without human interaction.
 */
export async function runAutomatedNightlyReconciliation(): Promise<NightlyReconcileResult> {
  const timestamp = new Date().toISOString();
  const runtime = getRuntimeEnv();
  const db = runtime.DB;

  console.log(`[${timestamp}] === STARTING AUTOMATED NIGHTLY RECONCILIATION ===`);
  await logActivity(db, "System", "reconcile.nightly_started", "Automated nightly reconciliation job started", {
    timestamp,
  });

  let reportExportTriggered = false;
  let csvReconciled = false;

  try {
    // 1. Programmatically request fresh Shiprocket cloud report export
    const exportResult = await triggerShiprocketExport();
    reportExportTriggered = exportResult.success;
    console.log(`Shiprocket automated export trigger:`, exportResult);

    // 2. Reconcile all local source-of-truth CSV files present in report/
    try {
      await reconcileSourceOfTruth();
      csvReconciled = true;
    } catch (e) {
      console.warn("CSV reconciliation skipped or encountered no new files:", e);
    }

    // 3. Reconcile active recent orders from past 14 days (re-checking OFD & NDR transitions)
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const ofdAuditResult = await syncTodayOfdAudit(db, todayStr).catch(() => ({ total: 0 }));

    // 4. Invalidate cache and update sync state
    invalidateCache();
    await setSyncState(db, "last_nightly_reconcile_at", timestamp);
    await setSyncState(db, "nightly_reconcile_status", "healthy");

    await logActivity(db, "System", "reconcile.nightly_completed", "Automated nightly reconciliation completed successfully", {
      reportExportTriggered,
      csvReconciled,
      auditOrders: ofdAuditResult.total,
    });

    console.log(`[${new Date().toISOString()}] === AUTOMATED NIGHTLY RECONCILIATION COMPLETE ===`);

    return {
      success: true,
      timestamp,
      reportExportTriggered,
      csvReconciled,
      ordersUpdated: ofdAuditResult.total,
      message: "Nightly automated reconciliation completed successfully.",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Nightly reconciliation error:", errorMsg);
    await setSyncState(db, "nightly_reconcile_status", "error");
    await setSyncState(db, "last_nightly_reconcile_error", errorMsg);

    return {
      success: false,
      timestamp,
      reportExportTriggered,
      csvReconciled,
      ordersUpdated: 0,
      message: "Nightly reconciliation encountered an error",
      error: errorMsg,
    };
  }
}
