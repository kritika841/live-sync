import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
export const poDefaults = {
 vendorName:'',vendorCompany:'',vendorAddress:'',vendorPhone:'',vendorGstin:'',
 companyName:'SATMI',billingAddress:'',gstin:'',deliveryAddress:'',contactPerson:'',
 paymentTerms:'',paymentMethod:'ONLINE',advancePayment:'',preparedBy:'',approvedBy:'',
 conditions:'Goods must match the specifications mentioned in this PO.\nAny damaged or incorrect items must be replaced by the vendor.\nInvoice should mention the PO Number.\nPayment will be processed as per the agreed payment terms after receipt and verification of goods.',
};
export type PoDetails=typeof poDefaults;
export type PoDocument={number:string;date:string;expected:string;details:PoDetails;lines:Array<{description:string;quantity:number;cost:number;gst:number;unit?:string}>};
export const poTotal=(lines:PoDocument['lines'])=>lines.reduce((sum,line)=>sum+Math.round(line.quantity*line.cost*(1+line.gst/100)*100)/100,0);
export async function renderPurchaseOrder(po:PoDocument) {
 const doc=await PDFDocument.create();const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const logo=await doc.embedPng(await readFile(join(process.cwd(),'public','po-logo.png')));
 let page=doc.addPage([595.92,842.88]),y=738;
 const ink=rgb(0,0,0),yellow=rgb(1,1,0);
 const text=(value:unknown,x:number,top:number,size=7.4,strong=false)=>page.drawText(String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7E\n]/g,' '),{x,y:top,size,font:strong?bold:regular,color:ink});
 const wrap=(value:string,width:number,size=7.4,strong=false)=>{
  const font=strong?bold:regular,lines:string[]=[];
  for(const paragraph of value.split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(font.widthOfTextAtSize((line+' '+word).trim(),size)>width && line){lines.push(line);line=word;}else line=(line+' '+word).trim();}lines.push(line);}
  return lines;
 };
 const ensure=(height:number)=>{if(y-height<42){page=doc.addPage([595.92,842.88]);y=790;text(`Purchase order ${po.number} (continued)`,50,y,10,true);y-=24;}};
 const pair=(label:string,value:string,strong=false)=>{const lines=wrap(value,400);ensure(Math.max(12,lines.length*10));text(label,52,y,label==='Expected Delivery Date'?6.2:7.4,strong);lines.forEach((line,i)=>text(line,128,y-i*10,7.4));y-=Math.max(12,lines.length*10);};
 const section=(label:string)=>{ensure(30);y-=10;text(label,52,y,9,true);y-=13;};
 const date=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split('-').reverse().join('/'):value;
 page.drawImage(logo,{x:85,y:753,width:100,height:logo.height/logo.width*100});
 pair('PO Number',po.number);pair('PO Date',date(po.date));pair('Expected Delivery Date',date(po.expected));
 section('Vendor Details');pair('Vendor Name:',po.details.vendorName,true);pair('Company Name:',po.details.vendorCompany,true);pair('Address:',po.details.vendorAddress,true);pair('Phone Number:',po.details.vendorPhone,true);pair('GSTIN :',po.details.vendorGstin,true);
 section('Billing Details');pair('Company Name:',po.details.companyName,true);pair('Billing Address:',po.details.billingAddress,true);pair('GSTIN:',po.details.gstin,true);pair('Delivery Address:',po.details.deliveryAddress,true);pair('Contact Person:',po.details.contactPerson,true);
 y-=7;
 const xs=[50,127,332,385,437,489,549], widths=xs.slice(1).map((x,i)=>x-xs[i]);
 const row=(values:string[],height:number,highlight=false)=>{ensure(height+15);for(let i=0;i<6;i++){page.drawRectangle({x:xs[i],y:y-height,width:widths[i],height,borderColor:ink,borderWidth:.5,...(highlight&&i===5?{color:yellow}:{})});const lines=wrap(values[i]||'',widths[i]-5,7.2,true);lines.forEach((line,j)=>text(line,xs[i]+2,y-9-j*9,7.2,true));}y-=height;};
 row(['Order Details','','','','',''],13);row(['S. No.','Item Description','Qty','Unit Price','GST','Total Amount'],13);
 for(const [index,line] of po.lines.entries()) {
  const height=Math.max(13,wrap(line.description,widths[1]-5,7.2,true).length*9+5);
  if(y-height<60){ensure(y);row(['S. No.','Item Description','Qty','Unit Price','GST','Total Amount'],13);}
  row([String(index+1),line.description,[line.quantity,line.unit].filter(v=>v!==undefined&&v!=='').join(' '),line.cost.toLocaleString('en-IN'),`${line.gst}%`,(Math.round(line.quantity*line.cost*(1+line.gst/100)*100)/100).toLocaleString('en-IN')],height);
 }
 const total=poTotal(po.lines).toLocaleString('en-IN',{maximumFractionDigits:2});row(['','','','','SUB TOTAL',total],13,true);
 y-=33;ensure(180);page.drawRectangle({x:127,y:y-3,width:205,height:13,color:yellow,borderColor:ink,borderWidth:.5});pair('Grand Total',total,true);pair('Payment Terms',po.details.paymentTerms,true);pair('Payment Method:',po.details.paymentMethod,true);pair('Advance Payment :',po.details.advancePayment,true);
 section('Terms & Conditions');for(const line of wrap(po.details.conditions,499,6.7,true)){ensure(11);text(line,52,y,6.7,true);y-=11;}
 text('Authorization',52,y,8,true);y-=13;pair('Prepared By:',po.details.preparedBy,true);pair('Approved By:',po.details.approvedBy,true);
 return doc.save();
}
