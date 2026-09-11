import { randomUUID } from 'node:crypto';
import type { DashboardUser } from '../auth/access';
import { HttpError, quantity, required } from '../http';
import { operationsDb } from './schema';
import { audit, conversion } from './inventory';
export type ReviewLine={description:string;componentId?:string;lineId?:string;quantity:string;cost:string;unit:string;checked:boolean};
export type Review={kind:'po'|'invoice';number:string;vendorId?:string;poId?:string;vendorNumber?:string;date:string;amount?:string;lines:ReviewLine[]};
export async function commitDocument(b:Review, file:{key:string;hash:string;name:string;text:string},u:DashboardUser){
 if(!['po','invoice'].includes(b.kind)||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)throw new HttpError(400,'Review between 1 and 100 line items');
 if(b.lines.some(l=>!l.checked))throw new HttpError(400,'Check every line against the PDF before saving');
 const number=required(b.number,'Document number');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date))throw new HttpError(400,'Choose a document date');
 const db=await operationsDb();const id=randomUUID(),now=new Date().toISOString();
 return db.transaction(async sql=>{
  let status='ordered';const comparisons=[];
  if(b.kind==='po'){
   await sql`INSERT INTO purchase_orders(id,po_number,supplier_id,status,order_date,vendor_order_number,created_by,created_at,updated_at) VALUES(${id},${number},${required(b.vendorId,'Vendor')},'ordered',${b.date},${String(b.vendorNumber||'')},${u.email},${now},${now})`;
   for(const l of b.lines){
    const [c]=await sql`SELECT * FROM inventory_components WHERE id=${required(l.componentId,'Component')}`;
    if(!c)throw new HttpError(400,'Select an existing component for every item');
    const factor=conversion(l.unit,c.unit);
    await sql`INSERT INTO purchase_order_lines(id,purchase_order_id,component_id,description,ordered_quantity,unit_cost,purchase_unit,conversion_factor,created_at) VALUES(${randomUUID()},${id},${c.id},${required(l.description,'Description')},${quantity(l.quantity)},${quantity(l.cost,'Unit price',true)},${l.unit},${factor},${now})`;
   }
  }else{
   const [po]=await sql`SELECT * FROM purchase_orders WHERE id=${required(b.poId,'Purchase order')} FOR UPDATE`;
   if(!po || ['cancelled','draft'].includes(po.status))throw new HttpError(400,'Select a valid purchase order');
   const seen=new Set<string>();status='matched';
   for(const l of b.lines){
    const lineId=required(l.lineId,'PO line');if(seen.has(lineId))throw new HttpError(400,'Combine duplicate invoice items for the same PO line');seen.add(lineId);
    const [p]=await sql`SELECT * FROM purchase_order_lines WHERE id=${lineId} AND purchase_order_id=${po.id}`;
    if(!p)throw new HttpError(400,'The selected item does not belong to this PO');
    const factor=conversion(l.unit,p.purchase_unit),qty=quantity(l.quantity)*factor,cost=quantity(l.cost,'Unit price',true)/factor;
    const [previous]=await sql`SELECT COALESCE(SUM(l.quantity),0) qty FROM supplier_invoice_lines l JOIN supplier_invoices i ON i.id=l.supplier_invoice_id WHERE l.purchase_order_line_id=${p.id} AND i.status<>'rejected'`;
    const flags=[];
    if(qty+Number(previous.qty)>Number(p.ordered_quantity)+1e-6)flags.push('Exceeds ordered quantity');
    if(qty+Number(previous.qty)>Number(p.received_quantity)+1e-6)flags.push('Not fully received');
    if(Math.abs(cost-Number(p.unit_cost))>0.01)flags.push('Unit price differs');
    if(flags.length)status='review_required';
    comparisons.push({lineId,componentId:p.component_id,description:required(l.description,'Description'),quantity:qty,unitCost:cost,ordered:Number(p.ordered_quantity),received:Number(p.received_quantity),previouslyInvoiced:Number(previous.qty),flags});
   }
   await sql`INSERT INTO supplier_invoices(id,supplier_id,purchase_order_id,invoice_number,invoice_date,storage_key,original_filename,file_hash,status,grand_total,extracted_json,created_by,created_at,updated_at) VALUES(${id},${po.supplier_id},${po.id},${number},${b.date},${file.key},${file.name},${file.hash},${status},${quantity(b.amount,'Invoice total',true)},${JSON.stringify({comparisons,reviewed:true})},${u.email},${now},${now})`;
   for(const l of comparisons)await sql`INSERT INTO supplier_invoice_lines(id,supplier_invoice_id,purchase_order_line_id,component_id,description,quantity,unit_cost,match_confidence,match_status) VALUES(${randomUUID()},${id},${l.lineId},${l.componentId},${l.description},${l.quantity},${l.unitCost},1,${l.flags.length?'review_required':'matched'})`;
  }
  await sql`INSERT INTO procurement_documents(id,kind,entity_id,storage_key,file_hash,filename,extracted_text,review_json,created_by) VALUES(${randomUUID()},${b.kind},${id},${file.key},${file.hash},${file.name},${file.text},${JSON.stringify({review:b,comparisons})},${u.id})`;
  await audit(sql,u,b.kind==='po'?'po_imported_from_pdf':'invoice_reconciled',id,{number,status,comparisons,fileHash:file.hash});
  return {id,status,comparisons};
 });
}
