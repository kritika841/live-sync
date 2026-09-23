import {configureSupabaseCron} from './configure-supabase-cron';
import {operationsDb} from '../lib/operations/schema';
import {getRuntimeEnv} from '../lib/database';
import {syncShopifyCatalog} from '../lib/shopify';
import {syncRecentOrders} from '../lib/shiprocket';
try{
 console.log('Starting Supabase initialization');
 const raw=getRuntimeEnv().DB;
 console.log('Core schema marker:',JSON.stringify(await raw.prepare("SELECT value FROM sync_state WHERE key='core_schema_revision'").first()));
 console.log('Installed operations revisions:',JSON.stringify((await raw.prepare("SELECT version FROM operations_schema_versions ORDER BY version").all()).results));
 const db=await operationsDb();
 const tables=await db.prepare("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('app_schema_migrations') ORDER BY tablename").all();
 console.log('Supabase schema verified:',JSON.stringify(tables.results));
 console.log('Public table security:',JSON.stringify((await db.prepare("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename").all()).results));
 const catalog=await db.prepare("SELECT value FROM sync_state WHERE key='shopify_catalog_last_sync_at'").first<{value:string}>();
 if(!catalog?.value || Date.now()-Date.parse(catalog.value)>86400000)console.log('Catalog:',JSON.stringify(await syncShopifyCatalog(getRuntimeEnv(),'Deployment setup')));
 else console.log('Catalog already imported today');
 console.log('Scheduler:',JSON.stringify(await configureSupabaseCron()));
 const recent=await db.prepare("SELECT value FROM sync_state WHERE key='fast_sync_checked_at'").first<{value:string}>();
 if(!recent?.value || Date.now()-Date.parse(recent.value)>600000)console.log('Recent order import:',JSON.stringify(await syncRecentOrders(getRuntimeEnv())));
 else console.log('Recent orders already imported; scheduled reconciliation will continue');
 console.log('Last provider validation:',JSON.stringify(await db.prepare("SELECT value FROM sync_state WHERE key='shiprocket_validation_json'").first()));
 if(process.env.VALIDATE_SHIPROCKET_ON_DEPLOY==='true')await import('./validate-shiprocket');
}catch(error){console.error('Production initialization failed:',error instanceof Error?error.message:'Unknown error');process.exitCode=1;}
