// Read-only coverage check. Never prints customer names, order IDs or phone numbers.
import {getRuntimeEnv} from '../lib/database';
import {shopifyConfigured,shopifyOrderContacts} from '../lib/shopify';
import {completePhone} from '../lib/contact';
try {
 const runtime=getRuntimeEnv();
 const coverage=await runtime.DB.prepare(`SELECT COUNT(*) total,COUNT(*) FILTER(WHERE customer_phone ~ '[*xX]') masked, COUNT(*) FILTER(WHERE customer_phone='') missing FROM orders WHERE confirmation_status IN ('pending','callback','unreachable')`).first();
 console.log(JSON.stringify({queueCoverage:coverage,shopifyConfigured:shopifyConfigured(runtime)}));
 const sample=await runtime.DB.prepare(`SELECT channel_order_id AS "channelOrderId" FROM orders WHERE LOWER(channel_name) LIKE '%shopify%' AND (customer_phone ~ '[*xX]' OR customer_phone='') ORDER BY order_date DESC LIMIT 5`).all<{channelOrderId:string}>();
 if(shopifyConfigured(runtime) && sample.results.length) {
  const contacts=await shopifyOrderContacts(runtime,sample.results.map(row=>row.channelOrderId));
  console.log(JSON.stringify({sampleSize:sample.results.length,exactMatches:contacts.size,completePhones:[...contacts.values()].filter(c=>completePhone(c.shippingAddress?.phone,c.phone,c.billingAddress?.phone)).length}));
 }
} catch(error) { console.error(error instanceof Error ? error.message : 'Coverage check failed');process.exitCode=1; }
