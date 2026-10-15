import { getRuntimeEnv } from "../lib/database";
import { readClosedDay } from "../lib/ofd-ledger";
import { calculateCohortMetrics } from "../lib/ofd-attempt";
(async () => {
  const db = getRuntimeEnv().DB;
  for (const d of ["2026-09-30","2026-10-13","2026-10-14"]) {
    const o = await readClosedDay(db, d);
    const m = calculateCohortMetrics(o as any, d, "2026-10-14");
    console.log(d, "rows", o?.length, "delivered", m.total.delivered, "undeliv", m.total.undelivered, "rto", m.total.rto, "unresolved", m.total.unresolved, "att1/2/3/4+", m.firstAttempt.count, m.secondAttempt.count, m.thirdAttempt.count, m.laterAttempt.count);
  }
  process.exit(0);
})();
