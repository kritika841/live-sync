import {getRuntimeEnv} from '../lib/database';
export async function configureSupabaseCron(){
 const secret=process.env.CRON_SECRET;if(!secret)throw Error('CRON_SECRET is missing');
 const origin='https://live-sync-theta.vercel.app';
 return getRuntimeEnv().DB.transaction(async sql=>{
  await sql`CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions`;
  const [existing]=await sql`SELECT id FROM vault.secrets WHERE name='satmi_dashboard_cron'`;
  if(existing)await sql`SELECT vault.update_secret(${existing.id}::uuid,${secret})`;
  else await sql`SELECT vault.create_secret(${secret},'satmi_dashboard_cron','Satmi scheduled requests')`;
  const jobs=[['satmi-orders','* * * * *','/api/cron/fast-sync'],['satmi-support','*/5 * * * *','/api/cron/support'],['satmi-verification','31 6,18 * * *','/api/cron/sync']];
  for(const [name,schedule,path] of jobs){
   const command=`SELECT net.http_get(url := '${origin}${path}',headers := jsonb_build_object('Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='satmi_dashboard_cron')),timeout_milliseconds := 300000);`;
   await sql`SELECT cron.schedule(${name},${schedule},${command})`;
  }
  return {jobs:jobs.map(j=>j[0]),provider:'Supabase Cron'};
 });
}
