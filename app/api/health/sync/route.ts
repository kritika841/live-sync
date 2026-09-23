import { withRequestDatabase } from "../../../../lib/database";
import { errorResponse as requestErrorResponse } from "../../../../lib/http";
import { requireApiUser } from '../../../../lib/auth/access';
import { getRuntimeEnv,ensureSchema } from '../../../../lib/database';
import { errorResponse } from '../../../../lib/http';
export const dynamic='force-dynamic';
async function GETHandler(){try{const a=await requireApiUser();if(a.response)return a.response;const db=getRuntimeEnv().DB;await ensureSchema(db);const {results}=await db.prepare("SELECT key,value FROM sync_state WHERE key IN ('last_sync_at','fast_sync_last_at','sync_status','last_webhook_at','last_sync_started_at','fast_sync_error','fast_sync_lease','fast_sync_checked_at','fast_sync_cursor')").all<{key:string;value:string}>();const s=Object.fromEntries(results.map(r=>[r.key,r.value]));const last=[s.last_sync_at,s.fast_sync_last_at,s.fast_sync_checked_at].filter(Boolean).sort().at(-1)||'';const historyPending=Number(s.fast_sync_cursor||1)>1;return Response.json({historyPending,state:((s.sync_status==='running'&&Date.now()-Date.parse(s.last_sync_started_at||'')<300000)||Date.parse(s.fast_sync_lease||'')>Date.now())?'syncing':!s.fast_sync_error&&last&&Date.now()-Date.parse(last)<180000?'healthy':'stale',lastSyncAt:last,lastEventAt:s.last_webhook_at||''});}catch(e){return errorResponse(e);}}

export async function GET(...args: Parameters<typeof GETHandler>) {
  try { return await withRequestDatabase(() => GETHandler(...args), 20000); }
  catch (error) { return requestErrorResponse(error); }
}
