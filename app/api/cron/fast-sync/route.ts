import { withRequestDatabase } from "../../../../lib/database";
import { errorResponse as requestErrorResponse } from "../../../../lib/http";
import { timingSafeEqual } from "node:crypto";
import { getRuntimeEnv } from "../../../../lib/database";
import {syncRecentShopifyTags} from "../../../../lib/shopify";
import { syncRecentOrders } from "../../../../lib/shiprocket";
import { errorResponse } from "../../../../lib/http";
export const dynamic="force-dynamic";
export const maxDuration=300;
async function GETHandler(request:Request){
 const expected=Buffer.from(process.env.CRON_SECRET||"");
 const received=Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"");
 if(!expected.length||expected.length!==received.length||!timingSafeEqual(expected,received))return Response.json({error:"Unauthorized"},{status:401});
 try{const runtime=getRuntimeEnv();const result=await syncRecentOrders(runtime);let shopify;try{shopify=await syncRecentShopifyTags(runtime);}catch(error){console.warn("Shopify tag sync failed",{message:error instanceof Error?error.message:"Unknown error"});shopify={error:"Tag sync will retry"};}return Response.json({...result,shopify});}catch(error){return errorResponse(error);}
}

export async function GET(...args: Parameters<typeof GETHandler>) {
  try { return await withRequestDatabase(() => GETHandler(...args), 270000); }
  catch (error) { return requestErrorResponse(error); }
}
