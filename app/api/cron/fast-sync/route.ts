import { timingSafeEqual } from "node:crypto";
import { getRuntimeEnv } from "../../../../lib/database";
import { syncRecentOrders } from "../../../../lib/shiprocket";
import { errorResponse } from "../../../../lib/http";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(request:Request){
 const expected=Buffer.from(process.env.CRON_SECRET||"");
 const received=Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"");
 if(!expected.length||expected.length!==received.length||!timingSafeEqual(expected,received))return Response.json({error:"Unauthorized"},{status:401});
 try{return Response.json(await syncRecentOrders(getRuntimeEnv()));}catch(error){return errorResponse(error);}
}
