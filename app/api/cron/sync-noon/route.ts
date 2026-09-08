import { GET as runScheduledSync } from "../sync/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return runScheduledSync(request);
}
