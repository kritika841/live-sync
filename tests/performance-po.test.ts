import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cachedValue} from '../lib/server-cache';
import {poTotal,poDefaults,renderPurchaseOrder} from '../lib/operations/po-document';
import {PDFDocument} from 'pdf-lib';
test('metadata cache shares in-flight loads and retries failed loaders',async()=>{
 let calls=0;const load=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return ['Courier'];};
 const values=await Promise.all([cachedValue('test-success',100,load),cachedValue('test-success',100,load)]);
 assert.equal(calls,1);assert.deepEqual(values,[['Courier'],['Courier']]);
 await assert.rejects(cachedValue('test-retry',100,async()=>{throw Error('temporary');}));
 assert.equal(await cachedValue('test-retry',100,async()=>42),42);
});
test('PO calculations match both references and long item lists paginate',async()=>{
 assert.equal(poTotal([{quantity:2000,cost:17.5,gst:18,description:''},{quantity:3200,cost:17.5,gst:18,description:''}]),107380);
 assert.equal(poTotal([{quantity:4000,cost:5.6,gst:5,description:''}]),23520);
 const pdf=await PDFDocument.load(await renderPurchaseOrder({number:'TEST',date:'2026-09-12',expected:'2026-09-20',details:poDefaults,lines:Array.from({length:50},()=>({description:'An item description which spans multiple lines in the purchase order table',quantity:1,cost:12.34,gst:18}))}));
 assert.ok(pdf.getPageCount()>1);
});
