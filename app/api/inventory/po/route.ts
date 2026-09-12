import {access} from '../../../../lib/operations/access';
import {operationsDb} from '../../../../lib/operations/schema';
import {errorResponse,HttpError} from '../../../../lib/http';
import {poDefaults,renderPurchaseOrder} from '../../../../lib/operations/po-document';
export async function GET(request:Request) {
 try {
  await access(request);const db=await operationsDb();
  const po=await db.prepare(`SELECT p.*,s.name,s.email,s.phone,s.tax_id,s.address FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?`).bind(new URL(request.url).searchParams.get('id')).first<Record<string,unknown>>();
  if(!po)throw new HttpError(404,'Purchase order not found');
  const lines=await db.prepare('SELECT * FROM purchase_order_lines WHERE purchase_order_id=? ORDER BY created_at,id').bind(po.id).all<Record<string,unknown>>();
  const details={...poDefaults,vendorName:String(po.name),vendorCompany:String(po.name),vendorAddress:String(po.address||''),vendorPhone:String(po.phone||''),vendorGstin:String(po.tax_id||''),preparedBy:String(po.created_by||''),...JSON.parse(String(po.document_json||'{}'))};
  const bytes=await renderPurchaseOrder({number:String(po.po_number),date:String(po.order_date),expected:String(po.expected_date),details,lines:lines.results.map(line=>({description:String(line.description),quantity:Number(line.ordered_quantity),unit:String(line.purchase_unit||''),cost:Number(line.unit_cost),gst:Number(line.tax_rate)}))});
  return new Response(Buffer.from(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${String(po.po_number).replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf"`,'Cache-Control':'private, no-store'}});
 }catch(error){return errorResponse(error);}
}
