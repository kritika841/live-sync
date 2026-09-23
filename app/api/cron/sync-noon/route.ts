import { withRequestDatabase } from "../../../../lib/database";
import { errorResponse as requestErrorResponse } from "../../../../lib/http";
import { errorResponse } from "../../../../lib/http";
import { GET as runScheduledSync } from "../sync/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handleGET(request: Request) {
  return runScheduledSync(request);
}

async function GETHandler(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }

export async function GET(...args: Parameters<typeof GETHandler>) {
  try { return await withRequestDatabase(() => GETHandler(...args), 270000); }
  catch (error) { return requestErrorResponse(error); }
}
