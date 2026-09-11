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

export async function GET(...args: Parameters<typeof handleGET>) { try { return await handleGET(...args); } catch (error) { return errorResponse(error); } }

export async function POST(...args: Parameters<typeof handlePOST>) { try { return await handlePOST(...args); } catch (error) { return errorResponse(error); } }
