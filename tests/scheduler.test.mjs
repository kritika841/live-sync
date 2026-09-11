import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invokeJob} from '../scripts/scheduler.mjs';
test('scheduler sends authenticated requests without redirecting secrets',async()=>{
 let called=false;await invokeJob('https://dashboard.example','test-secret','/api/cron/fast-sync',async(url,options)=>{called=true;assert.equal(url.href,'https://dashboard.example/api/cron/fast-sync');assert.equal(options.headers.Authorization,'Bearer test-secret');assert.equal(options.redirect,'error');return Response.json({imported:2});});assert.equal(called,true);
});
test('scheduler rejects unsafe destinations and failed responses',async()=>{
 await assert.rejects(invokeJob('http://remote.example','s','/x'),/HTTPS/);
 await assert.rejects(invokeJob('https://dashboard.example','s','/x',async()=>new Response('',{status:503})),/503/);
 await assert.rejects(invokeJob('https://dashboard.example','s','/x',async()=>Response.json({error:'failed'})),/failure/);
});
