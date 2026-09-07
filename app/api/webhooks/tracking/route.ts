import {
  GET as shiprocketStatus,
  POST as receiveShiprocketStatus,
} from "../shiprocket/route";

export const dynamic = "force-dynamic";

export async function GET() {
  return shiprocketStatus();
}

export async function POST(request: Request) {
  return receiveShiprocketStatus(request);
}
