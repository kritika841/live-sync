import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import postgres from 'postgres';
process.env.SUPABASE_DB_URL='postgres://satmi_test@127.0.0.1:55439/postgres';
const {getRuntimeEnv,ensureSchema}=await import('../lib/database');
const {loadOfdRecords}=await import('../lib/ofd');
const {syncRecentOrders}=await import('../lib/shiprocket');
const db=getRuntimeEnv().DB;
const sql=postgres(process.env.SUPABASE_DB_URL,{max:1});
after(async()=>{await sql.end();});
test('OFD uses India dates, deduplicates repeats and does not invent attempts from NDR totals',async()=>{
 await ensureSchema(db);
 const id=900000000+Math.floor(Math.random()*1000000);
 await sql`INSERT INTO orders(id,channel_order_id,status,ndr_attempts,out_for_delivery_at,channel_id,channel_name,synced_at) VALUES(${id},${'audit-'+id},'OUT FOR DELIVERY',9,'2026-09-11T05:00:00.000Z',123,'Test','2026-09-11T05:00:00.000Z')`;
 try{
 for(const [status,date] of [['OUT FOR DELIVERY','2026-09-09T20:00:00.000Z'],['OUT FOR DELIVERY','2026-09-09T20:01:00.000Z'],['UNDELIVERED','2026-09-10T12:00:00.000Z'],['OUT FOR DELIVERY','2026-09-11T05:00:00.000Z']])await sql`INSERT INTO webhook_events(shiprocket_order_id,status,event_at,received_at,payload_json)VALUES(${id},${status},${date},${date},'{}')`;
 let row=(await loadOfdRecords(db,'2026-09-11')).results.find(r=>Number(r.id)===id)!;
 assert.equal(Number(row.attemptNumber),2);assert.equal(row.previousUndelivered,true);
 row=(await loadOfdRecords(db,'2026-09-10')).results.find(r=>Number(r.id)===id)!;
 assert.equal(Number(row.attemptNumber),1);assert.equal(row.previousUndelivered,false);
 await sql`DELETE FROM webhook_events WHERE shiprocket_order_id=${id}`;
 row=(await loadOfdRecords(db,'2026-09-11')).results.find(r=>Number(r.id)===id)!;
 assert.equal(row.attemptNumber,null);assert.equal(row.previousUndelivered,false);
 }finally{await sql`DELETE FROM webhook_events WHERE shiprocket_order_id=${id}`;await sql`DELETE FROM orders WHERE id=${id}`;}
});
test('fast sync lease excludes overlap and malformed provider responses never advance freshness',async()=>{
 await ensureSchema(db);
 const runtime={...getRuntimeEnv(),SHIPROCKET_CHANNEL_ID:'123'};
 await sql`INSERT INTO sync_state(key,value,updated_at) VALUES('fast_sync_lease',${new Date(Date.now()+60000).toISOString()},'test') ON CONFLICT(key)DO UPDATE SET value=EXCLUDED.value`;
 assert.equal((await syncRecentOrders(runtime)).skipped,true);
 await sql`DELETE FROM sync_state WHERE key='fast_sync_lease'`;
 await sql`INSERT INTO sync_state(key,value,updated_at) VALUES('shiprocket_token','test-only','test'),('shiprocket_token_expires_at',${new Date(Date.now()+86400000).toISOString()},'test') ON CONFLICT(key)DO UPDATE SET value=EXCLUDED.value`;
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:200});
 try{await assert.rejects(syncRecentOrders(runtime),/empty or invalid/);const rows=await sql`SELECT value FROM sync_state WHERE key='fast_sync_lease'`;assert.equal(rows.length,0);}finally{globalThis.fetch=original;await sql`DELETE FROM sync_state WHERE key IN ('shiprocket_token','shiprocket_token_expires_at','fast_sync_error')`;}
});
test('fast sync drains its cursor while checking the newest page on every invocation',async()=>{
 await ensureSchema(db);
 const runtime={...getRuntimeEnv(),SHIPROCKET_CHANNEL_ID:'123'};
 await sql`DELETE FROM sync_state WHERE key IN ('fast_sync_lease','fast_sync_cursor','fast_sync_from','fast_sync_last_at')`;
 await sql`INSERT INTO sync_state(key,value,updated_at) VALUES('shiprocket_token','test-only','test'),('shiprocket_token_expires_at',${new Date(Date.now()+86400000).toISOString()},'test') ON CONFLICT(key)DO UPDATE SET value=EXCLUDED.value`;
 const original=globalThis.fetch;const pages:number[]=[];
 globalThis.fetch=async(input)=>{pages.push(Number(new URL(String(input)).searchParams.get('page')));return Response.json({data:[],meta:{pagination:{total_pages:6}}});};
 try{
 assert.equal((await syncRecentOrders(runtime)).pending,true);
 assert.deepEqual(pages,[1,2]);
 assert.equal((await sql`SELECT value FROM sync_state WHERE key='fast_sync_last_at'`).length,0);
 for(let i=0;i<3;i++)assert.equal((await syncRecentOrders(runtime)).pending,true);
 assert.equal((await syncRecentOrders(runtime)).pending,false);
 assert.deepEqual(pages,[1,2,1,3,1,4,1,5,1,6]);
 assert.equal((await sql`SELECT value FROM sync_state WHERE key='fast_sync_last_at'`).length,1);
 }finally{globalThis.fetch=original;await sql`DELETE FROM sync_state WHERE key IN ('shiprocket_token','shiprocket_token_expires_at','fast_sync_cursor','fast_sync_from','fast_sync_last_at','fast_sync_checked_at')`;}
});
test('batched writes remain atomic on a constraint failure',async()=>{
 await ensureSchema(db);
 const key='atomic-'+Date.now();
 const insert=()=>db.prepare('INSERT INTO sync_state(key,value,updated_at)VALUES(?,?,?)').bind(key,'test','test');
 await assert.rejects(db.batch([insert(),insert()]));
 assert.equal((await sql`SELECT key FROM sync_state WHERE key=${key}`).length,0);
});
