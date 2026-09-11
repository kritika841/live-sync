// Runs on an always-on machine; dashboard may be local or remote.
// Node 22+, no npm packages. Credentials come only from its environment file.
import {pathToFileURL} from 'node:url';
export async function invokeJob(base,secret,path,fetcher=fetch){
 const url=new URL(base);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Use a dashboard origin without credentials or a path');
 if(url.protocol!=='https:' && !(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Remote dashboards require HTTPS');
 if(!secret)throw Error('CRON_SECRET is required');
 const response=await fetcher(new URL(path,url),{headers:{Authorization:`Bearer ${secret}`},redirect:'error',signal:AbortSignal.timeout(300000)});
 if(!response.ok)throw Error(`Job returned HTTP ${response.status}`);
 const result=await response.json();
 if(result.error)throw Error('Job reported a failure');
 return result;
}
export function startScheduler(base,secret){
 const jobs=[{path:'/api/cron/fast-sync',every:60000},{path:'/api/cron/support',every:300000},{path:'/api/cron/sync',every:43200000}].map(j=>({...j,running:false,next:0}));
 const tick=()=>{for(const job of jobs){if(job.running||Date.now()<job.next)continue;job.running=true;job.next=Date.now()+job.every;
 invokeJob(base,secret,job.path).then(result=>{if(result.hasMore)job.next=Date.now()+60000;console.log(new Date().toISOString(),job.path,result.hasMore?'continuing import':'completed');}).catch(e=>console.error(new Date().toISOString(),job.path,e.message)).finally(()=>{job.running=false;});}};
 tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const base=process.env.DASHBOARD_URL,secret=process.env.CRON_SECRET;
 if(!base||!secret)throw Error('Set DASHBOARD_URL and CRON_SECRET in a protected environment file');
 const stop=startScheduler(base,secret);for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>{stop();process.exit(0);});
}
