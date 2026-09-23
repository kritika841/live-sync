import { withRequestDatabase } from "../../../../lib/database";
import { errorResponse as requestErrorResponse } from "../../../../lib/http";
import { errorResponse } from "../../../../lib/http";
import {
  GET as shiprocketStatus,
  POST as receiveShiprocketStatus,
} from "../shiprocket/route";

export const dynamic = "force-dynamic";

async function handleGET() {
  return shiprocketStatus();
}

async function handlePOST(request: Request) {
  return receiveShiprocketStatus(request);
}

async function GETHandler(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }

async function POSTHandler(...args: Parameters<typeof handlePOST>) { try { return await handlePOST(...args); } catch (error) { return errorResponse(error); } }

export async function GET(...args: Parameters<typeof GETHandler>) {
  try { return await withRequestDatabase(() => GETHandler(...args), 20000); }
  catch (error) { return requestErrorResponse(error); }
}

export async function POST(...args: Parameters<typeof POSTHandler>) {
  try { return await withRequestDatabase(() => POSTHandler(...args), 270000); }
  catch (error) { return requestErrorResponse(error); }
}
