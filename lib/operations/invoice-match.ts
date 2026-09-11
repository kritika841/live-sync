import type {TransactionSql} from 'postgres';
import {HttpError} from '../http';
export async function recheckInvoice(sql:TransactionSql,id:string){
 const [invoice]=await sql`SELECT * FROM supplier_invoices WHERE id=${id}`;
 if(!invoice?.purchase_order_id)throw new HttpError(404,'Invoice or linked PO not found');
 await sql`SELECT id FROM purchase_orders WHERE id=${invoice.purchase_order_id} FOR UPDATE`;
 const lines=await sql`SELECT i.*,p.ordered_quantity,p.received_quantity,p.unit_cost po_cost,COALESCE((SELECT SUM(l.quantity) FROM supplier_invoice_lines l JOIN supplier_invoices inv ON inv.id=l.supplier_invoice_id WHERE l.purchase_order_line_id=i.purchase_order_line_id AND inv.id<>${id} AND inv.status<>'rejected'),0) prior FROM supplier_invoice_lines i JOIN purchase_order_lines p ON p.id=i.purchase_order_line_id WHERE i.supplier_invoice_id=${id}`;
 if(!lines.length)throw new HttpError(400,'Import and map invoice items before matching this invoice');
 const comparisons=[];
 for(const l of lines){const flags=[];if(Number(l.quantity)+Number(l.prior)>Number(l.ordered_quantity)+1e-6)flags.push('Exceeds ordered quantity');if(Number(l.quantity)+Number(l.prior)>Number(l.received_quantity)+1e-6)flags.push('Not fully received');if(Math.abs(Number(l.unit_cost)-Number(l.po_cost))>0.01)flags.push('Unit price differs');
  comparisons.push({description:l.description,lineId:l.purchase_order_line_id,quantity:Number(l.quantity),ordered:Number(l.ordered_quantity),received:Number(l.received_quantity),previouslyInvoiced:Number(l.prior),flags});
  await sql`UPDATE supplier_invoice_lines SET match_status=${flags.length?'review_required':'matched'} WHERE id=${l.id}`;
 }
 const status=comparisons.some(c=>c.flags.length)?'review_required':'matched';
 await sql`UPDATE supplier_invoices SET status=${status},extracted_json=${JSON.stringify({comparisons,reviewed:true})},updated_at=${new Date().toISOString()} WHERE id=${id}`;
 return {status,comparisons};
}
