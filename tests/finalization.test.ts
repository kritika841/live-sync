import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {closedSql,openPopulationSql} from '../lib/analytics-status';
import {tagRowsSql} from '../lib/order-tags-sql';
import {completePhone} from '../lib/contact';
process.env.SUPABASE_DB_URL=`postgres://satmi_test@127.0.0.1:${process.env.SATMI_TEST_PORT || "55439"}/postgres`;
const {operationsDb}=await import('../lib/operations/schema');
const {mutateInventory}=await import('../lib/operations/inventory');
const {mutateSupport}=await import('../lib/operations/support');
const sql=postgres(process.env.SUPABASE_DB_URL,{max:1});
after(()=>sql.end());
const admin={id:'finalize-admin',email:'test@example.test',name:'Test',role:'admin'};
test('analytics status populations match transcript, including OFD and excluding pickup exceptions',async()=>{
 const statuses=['DELIVERED','RTO DELIVERED','RTO IN TRANSIT','RTO INITIATED','RTO NDR','OUT FOR DELIVERY','UNDELIVERED','IN TRANSIT','REACHED AT DESTINATION HUB','LOST','READY TO SHIP','PICKUP EXCEPTION','NEW'];
 const rows=await sql.unsafe(`SELECT status,${closedSql} attempted,${openPopulationSql} shipped FROM unnest($1::text[]) t(status)`,[statuses]);
 assert.equal(rows.filter(r=>r.attempted).length,7);
 assert.equal(rows.filter(r=>r.shipped).length,10);
 assert.equal((2392/3105*100).toFixed(2),'77.04');
});
test('tag filtering accepts exact array and comma-separated values without substring matches',async()=>{
 const raw=JSON.stringify({shopify_tags:['VIP','Sale'],tags:'Repeat, Special'});
 const rows=await sql.unsafe(`SELECT tag FROM (SELECT $1::text raw_json) o CROSS JOIN LATERAL (${tagRowsSql}) t`,[raw]);
 assert.deepEqual(rows.map(r=>r.tag).sort(),['Repeat','Sale','Special','VIP']);
 const match=await sql.unsafe(`SELECT EXISTS (${tagRowsSql} WHERE LOWER(TRIM(tag_value))=LOWER($2)) matched FROM (SELECT $1::text raw_json) o`,[raw,'vi']);
 assert.equal(match[0].matched,false);
});
test('phone fallback skips masked sources and preserves complete numbers',()=>{
 assert.equal(completePhone('98XXXX1234','+91 98765 43210'),'+91 98765 43210');
 assert.equal(completePhone('***1234',null),'');
});
test('50 kg PO remains pending after 25 and 23 kg, completes after final 2 kg with distinct invoices',async()=>{
 await operationsDb();const component=randomUUID(),vendor=randomUUID(),po=randomUUID();
 await mutateInventory({action:'component',id:component,name:'Incense',sku:component,unit:'kg'},admin);
 await mutateInventory({action:'vendor',id:vendor,name:vendor,address:'Test',bankDetails:'Test'},admin);
 await mutateInventory({action:'po',id:po,number:po,vendorId:vendor,lines:[{componentId:component,quantity:50,unit:'kg',cost:1}]},admin);
 const [line]=await sql`SELECT id FROM purchase_order_lines WHERE purchase_order_id=${po}`;
 await assert.rejects(()=>mutateInventory({action:'receive',poId:po,requestKey:randomUUID(),lines:[{lineId:line.id,accepted:25}]},admin),/Invoice/);
 for(const [index,qty] of [25,23,2].entries()) {
  const invoice=randomUUID();await sql`INSERT INTO supplier_invoices(id,supplier_id,purchase_order_id,invoice_number,storage_key,file_hash,created_at,updated_at) VALUES(${invoice},${vendor},${po},${invoice},'test-only',${invoice},'test','test')`;
  await sql`INSERT INTO supplier_invoice_lines(id,supplier_invoice_id,purchase_order_line_id,component_id,quantity,unit_cost) VALUES(${randomUUID()},${invoice},${line.id},${component},${qty},1)`;
  const receipt={action:'receive',poId:po,invoiceId:invoice,requestKey:randomUUID(),lines:[{lineId:line.id,accepted:qty,rejected:0}]};
  await mutateInventory(receipt,admin);await mutateInventory(receipt,admin);
  const [result]=await sql`SELECT status FROM purchase_orders WHERE id=${po}`;
  assert.equal(result.status,index===2?'received':'partially_received');
  if(index<2)await assert.rejects(()=>mutateInventory({...receipt,requestKey:randomUUID(),lines:[{lineId:line.id,accepted:1}]},admin),/invoice/);
 }
 const [stock]=await sql`SELECT SUM(quantity_delta) qty FROM component_ledger WHERE component_id=${component}`;assert.equal(Number(stock.qty),50);
 const db=await operationsDb();const aliases=await db.prepare('SELECT 123 AS orderId, \'confirmed\' AS rejectionReason').first<{orderId:number;rejectionReason:string}>();assert.equal(aliases?.orderId,123);
});
test('manual support tickets choose least-loaded available agent and deduplicate request keys',async()=>{
 await operationsDb();const previous=await sql`SELECT user_id,available FROM support_agents WHERE role='support_agent'`; await sql`UPDATE support_agents SET available=false WHERE role='support_agent'`;
 try {
 const a=randomUUID(),b=randomUUID();
 for(const id of [a,b])await sql`INSERT INTO support_agents(user_id,email,name,role,available) VALUES(${id},${id+'@example.test'},${id},'support_agent',true)`;
 const request={action:'create',email:'customer@example.test',subject:'Test case',query:'Question',requestKey:randomUUID()};
 const first=await mutateSupport(request,admin);assert.deepEqual(await mutateSupport(request,admin),first);
 const second=await mutateSupport({...request,requestKey:randomUUID()},admin);
 const rows=await sql`SELECT assignee_id,ticket_number FROM support_tickets WHERE id IN (${first.id},${second.id})`;
 assert.equal(new Set(rows.map(r=>r.assignee_id)).size,2);assert.equal(new Set(rows.map(r=>r.ticket_number)).size,2);
 const waiting=randomUUID();await sql`INSERT INTO support_tickets(id,mailbox,gmail_thread_id,subject,customer_email) SELECT ${waiting},mailbox,${randomUUID()},'Waiting case','waiting@example.test' FROM support_tickets WHERE id=${first.id}`;
 await mutateSupport({action:'availability',agentId:a,available:true},admin);
 const [assigned]=await sql`SELECT assignee_id FROM support_tickets WHERE id=${waiting}`;assert.ok(assigned.assignee_id);
 const [preserved]=await sql`SELECT assignee_id FROM support_tickets WHERE id=${first.id}`;assert.equal(preserved.assignee_id,rows.find(r=>Number(r.ticket_number)===Math.min(...rows.map(r=>Number(r.ticket_number))))?.assignee_id);

 } finally { for(const agent of previous) await sql`UPDATE support_agents SET available=${agent.available} WHERE user_id=${agent.user_id}`; }
});
