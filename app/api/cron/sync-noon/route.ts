import { errorResponse } from "../../../../lib/http";
import { GET as runScheduledSync } from "../sync/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handleGET(request: Request) {
  return runScheduledSync(request);
}

export async function GET(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }
