import { getRuntimeEnv } from "../lib/database";
import { previewDay, verificationRefs } from "../lib/ofd-day-close";
import { readClosedDay } from "../lib/ofd-ledger";
import { getShiprocketToken, syncTrackingHistories } from "../lib/shiprocket";

async function compare(label: string, date: string) {
  const db = getRuntimeEnv().DB;
  const truth = await readClosedDay(db, date) || [];
  const t = new Map(truth.map((o) => [String(o.id), o]));
  const p = await previewDay(db, date);
  let missing = 0, extra = 0, statusDiff = 0, attemptDiff = 0;
  for (const [id, o] of t) {
    const r = p.summary.get(id);
    if (!r) { missing++; continue; }
    const ts = String(o.status).startsWith("UNDELIVERED") ? "UNDELIVERED" : String(o.status);
    const ps = r.status.startsWith("UNDELIVERED") ? "UNDELIVERED" : r.status;
    if (ts !== ps) statusDiff++;
    if (Number(o.attemptNumber) !== r.attempt) attemptDiff++;
  }
  for (const id of p.summary.keys()) if (!t.has(id)) extra++;
  console.log(`${label} ${date}: truth=${t.size} pipeline=${p.summary.size} missing=${missing} extra=${extra} statusDiff=${statusDiff} attemptDiff=${attemptDiff}`);
}

(async () => {
  const runtime = getRuntimeEnv();
  const dates = ["2026-10-12", "2026-10-13"];
  for (const d of dates) await compare("WEBHOOK-ONLY", d);
  if (process.argv.includes("--verify")) {
    const token = await getShiprocketToken(runtime);
    for (const d of dates) {
      const refs = await verificationRefs(runtime.DB, d);
      console.log(`verifying ${d}: ${refs.length} orders with Shiprocket...`);
      const r = await syncTrackingHistories(runtime.DB, token, refs);
      console.log(JSON.stringify(r));
      await compare("AFTER-VERIFY", d);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
