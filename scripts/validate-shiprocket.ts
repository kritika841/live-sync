// Independent provider reconciliation. Output contains counts and non-PII order IDs only.
import fs from 'node:fs/promises';
import {getRuntimeEnv,setSyncState} from '../lib/database';
import {getShiprocketToken,resolveChannel,normalizeShiprocketDate,upsertOrders} from '../lib/shiprocket';
const runtime=getRuntimeEnv();
const token=await getShiprocketToken(runtime),channel=await resolveChannel(runtime,token);
const orders=new Map<number,Record<string,unknown>>();
const indiaDate=(value:unknown)=>{const raw=normalizeShiprocketDate(value);return raw.includes('T')?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(raw)):raw.slice(0,10);};
const output='.local/shiprocket-validation.json';
let totalPages=1;
for(let page=1;page<=totalPages;page++) {
 const params=new URLSearchParams({page:String(page),per_page:'250',channel_id:String(channel.id),from:'2026-06-28',to:'2026-09-12',sort:'DESC',sort_by:'id'});
 const response=await fetch(`https://apiv2.shiprocket.in/v1/external/orders?${params}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Provider page ${page}: ${response.status}`);
 const body=await response.json(); if(!Array.isArray(body.data))throw new Error('Missing provider records');
 totalPages=Number(body.meta?.pagination?.total_pages||1);if(totalPages>500)throw new Error('Unexpected pagination');
 for(const order of body.data)orders.set(Number(order.id),order);
 console.log(JSON.stringify({page,totalPages,records:orders.size}));
}
// Refresh authoritative provider fields while preserving confirmation history and Shopify tags.
if(process.env.RECONCILE_SHIPROCKET_ON_DEPLOY==='true')await upsertOrders(runtime.DB,[...orders.values()]);
const stored=await runtime.DB.prepare('SELECT id,status,order_date AS "orderDate" FROM orders').all<{id:number;status:string;orderDate:string}>();
const byId=new Map(stored.results.map(o=>[Number(o.id),o]));
const periods=[];
for(const [from,to] of [['2026-07-01','2026-07-31'],['2026-08-01','2026-08-31'],['2026-09-01','2026-09-12']]) {
 const statusCounts:Record<string,number>={},missing:number[]=[],mismatches:unknown[]=[],dateMismatches:unknown[]=[];
 const ids=new Set<number>();
 for(const [id,order] of orders) {
  const date=indiaDate(order.channel_created_at||order.order_date||order.created_at);if(date<from||date>to)continue;
  ids.add(id);const status=String(order.status||'').trim().toUpperCase();statusCounts[status]=(statusCounts[status]||0)+1;
  const local=byId.get(id);if(!local){missing.push(id);continue;}
  if(local.status.trim().toUpperCase()!==status)mismatches.push({id,provider:status,stored:local.status});
  if(indiaDate(local.orderDate)!==date)dateMismatches.push({id,provider:date,stored:indiaDate(local.orderDate)});
 }
 const extra=stored.results.filter(o=>indiaDate(o.orderDate)>=from&&indiaDate(o.orderDate)<=to&&!ids.has(Number(o.id))).map(o=>Number(o.id));
 // Rules transcribed independently, not imported from the analytics implementation.
 let delivered=0,attempted=0,shipped=0;
 for(const [status,count] of Object.entries(statusCounts)) {
  const isDelivered=['DELIVERED','DELIVERED TO CUSTOMER'].includes(status);
  const isAttempted=isDelivered||status.startsWith('RTO')||status.includes('RETURN TO ORIGIN')||status.startsWith('UNDELIVERED')||['NDR','NDR PENDING','OUT FOR DELIVERY'].includes(status);
  if(isDelivered)delivered+=count;if(isAttempted)attempted+=count;
  if(isAttempted||['SHIPPED','IN TRANSIT','IN TRANSIT-EN-ROUTE','IN TRANSIT-AT DESTINATION HUB','REACHED AT DESTINATION HUB','PICKED UP','MISROUTED','UNTRACEABLE','LOST'].includes(status))shipped+=count;
 }
 const {deliveredSql,closedSql,openPopulationSql}=await import('../lib/analytics-status');
 const dateSql="CASE WHEN order_date ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN TO_CHAR(order_date::timestamptz AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') ELSE SUBSTR(order_date,1,10) END";
 const started=performance.now();
 const metrics=await runtime.DB.prepare(`SELECT COUNT(*) total,COUNT(*) FILTER(WHERE ${deliveredSql}) delivered,COUNT(*) FILTER(WHERE ${closedSql}) attempted,COUNT(*) FILTER(WHERE ${openPopulationSql}) shipped FROM orders WHERE (${dateSql})>=? AND (${dateSql})<=?`).bind(from,to).first<Record<string,number>>();
 const metricMatch=Number(metrics?.total)===ids.size&&Number(metrics?.delivered)===delivered&&Number(metrics?.attempted)===attempted&&Number(metrics?.shipped)===shipped;
 periods.push({from,to,metricMatch,databaseMetrics:metrics,queryMs:Math.round(performance.now()-started),providerCount:ids.size,statusCounts,missing,mismatches,dateMismatches,extra,delivered,attempted,shipped,attemptedRate:attempted?delivered/attempted*100:0,shippedRate:shipped?delivered/shipped*100:0});
}
await fs.mkdir('.local',{recursive:true});await fs.writeFile(output,JSON.stringify({checkedAt:new Date().toISOString(),providerRecords:orders.size,periods},null,2));
await fs.writeFile('.local/shiprocket-provider-orders.json',JSON.stringify([...orders.values()]));

const summary={checkedAt:new Date().toISOString(),providerRecords:orders.size,periods:periods.map(({missing,mismatches,dateMismatches,extra,...rest})=>({...rest,missing:missing.length,statusMismatches:mismatches.length,dateMismatches:dateMismatches.length,extra:extra.length}))};
await setSyncState(runtime.DB,'shiprocket_validation_json',JSON.stringify(summary));
if(periods.some(p=>!p.metricMatch||p.missing.length||p.mismatches.length||p.dateMismatches.length||p.extra.length))throw new Error('Provider reconciliation found discrepancies; inspect shiprocket_validation_json in sync_state');
console.log('Shiprocket reconciliation passed:',JSON.stringify(summary));
