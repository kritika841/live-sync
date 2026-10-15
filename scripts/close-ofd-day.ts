/**
 * Manually run the end-of-day close (normally the cron does this).
 *
 *   npm run close:ofd                         # run the normal cycle (catch up every unsealed day)
 *   npm run close:ofd -- 2026-10-13           # close one passed day: capture -> verify -> seal
 *   npm run close:ofd -- 2026-10-13 --no-verify   # seal from webhook data only
 *   npm run close:ofd -- 2026-10-13 --force       # re-close a day that is already sealed
 */
import { getRuntimeEnv } from "../lib/database";
import { closeDay, runDayCloseCycle } from "../lib/ofd-day-close";

async function main() {
  const args = process.argv.slice(2);
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const runtime = getRuntimeEnv();
  const result = date
    ? await closeDay(runtime, date, { verify: !args.includes("--no-verify"), force: args.includes("--force") })
    : await runDayCloseCycle(runtime);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
