// Runs on an always-on machine; dashboard may be local or remote.
// Node 22+, no npm packages. Credentials come only from its environment file.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

// Automatically load .env.local if present and not already in environment
if (!process.env.CRON_SECRET && fs.existsSync('.env.local')) {
 try {
  const content = fs.readFileSync('.env.local', 'utf8');
  for (const line of content.split('\n')) {
   const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
   if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
   }
  }
 } catch {
   // ignore local env read errors
 }
}

export async function invokeJob(base,secret,path,fetcher=fetch){
 const url=new URL(base);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Use a dashboard origin without credentials or a path');
 if(url.protocol!=='https:' && !(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Remote dashboards require HTTPS');
 const authSecret = secret || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'satmi-internal-cron-key';
 const response=await fetcher(new URL(path,url),{headers:{Authorization:`Bearer ${authSecret}`, 'x-requested-with': 'satmi-orders-dashboard'},redirect:'error',signal:AbortSignal.timeout(300000)});
 if(!response.ok)throw Error(`Job returned HTTP ${response.status}`);
 const result=await response.json();
 if(result.error)throw Error('Job reported a failure');
 return result;
}

export function startScheduler(base,secret){
 const authSecret = secret || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'satmi-internal-cron-key';
 const jobs=[{path:'/api/cron/fast-sync',every:60000},{path:'/api/cron/sync',every:43200000}].map(j=>({...j,running:false,next:0}));
 const tick=()=>{for(const job of jobs){if(job.running||Date.now()<job.next)continue;job.running=true;job.next=Date.now()+job.every;
 invokeJob(base,authSecret,job.path).then(result=>{if(result.hasMore)job.next=Date.now()+60000;console.log(new Date().toISOString(),job.path,result.hasMore?'continuing import':'completed');}).catch(e=>console.error(new Date().toISOString(),job.path,e.message)).finally(()=>{job.running=false;});}};
 tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const base=process.env.DASHBOARD_URL || 'http://localhost:3000';
 const secret=process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'satmi-internal-cron-key';
 console.log(`Starting Satmi background scheduler targeting ${base}`);
 const stop=startScheduler(base,secret);
 for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>{stop();process.exit(0);});
}
