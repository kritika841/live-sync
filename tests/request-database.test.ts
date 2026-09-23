import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_DB_URL=`postgres://satmi_test@127.0.0.1:${process.env.SATMI_TEST_PORT || '55449'}/postgres`;
const {withRequestDatabase,getRuntimeEnv}=await import('../lib/database');
test('concurrent requests have isolated connections and nested operations retain ownership',async()=>{
 let signal!:()=>void;
 const started=new Promise<void>(resolve=>{signal=resolve;});
 const slow=withRequestDatabase(async()=>{
  const db=getRuntimeEnv().DB;
  assert.equal(await withRequestDatabase(async()=>getRuntimeEnv().DB),db);
  signal();await db.prepare('SELECT pg_sleep(0.5)').first();return db;
 });
 await started;
 const begin=performance.now();
 const fast=await withRequestDatabase(async()=>{const db=getRuntimeEnv().DB;assert.equal((await db.prepare('SELECT 42 AS answer').first<{answer:number}>())?.answer,42);return db;});
 assert.ok(performance.now()-begin<400,'Independent request must not queue behind slow request');
 assert.notEqual(fast,await slow);
});
test('timed out request releases its connection and subsequent requests recover',async()=>{
 await assert.rejects(withRequestDatabase(async()=>{await getRuntimeEnv().DB.prepare('SELECT pg_sleep(3)').first();},40),/timed out/);
 assert.equal(await withRequestDatabase(async()=>(await getRuntimeEnv().DB.prepare('SELECT 1 AS ok').first<{ok:number}>())?.ok),1);
});
