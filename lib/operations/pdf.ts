import { getDocumentProxy } from 'unpdf';
import { HttpError } from '../http';
export type ExtractedLine = { description: string; quantity: string; unit: string; cost: string };
// Conservative table parser: only rows with a description, quantity and rate qualify.
export function parseRows(rows: string[]): ExtractedLine[] {
  const result: ExtractedLine[] = [];
  for (const row of rows) {
    if (/\b(sub.?total|grand total|tax total|amount due|bank|ifsc|gstin|total amount)\b/i.test(row)) continue;
    const cells = row.trim().split(/\s{2,}|\t|\|/).map(s=>s.trim()).filter(Boolean);
    if(cells.length < 3) {
      const plain=row.trim().match(/^(?:\d+[.)]?\s+)?([A-Za-z][A-Za-z0-9 ()/.-]*?)\s+(\d[\d,]*(?:\.\d+)?)\s*(kg|kgs|g|grams|packs?|pcs|units?)?\s+(?:₹|Rs\.?|INR)?\s*(\d[\d,]*(?:\.\d+)?)\s+(?:₹|Rs\.?|INR)?\s*(\d[\d,]*(?:\.\d+)?)(?:\s.*)?$/i);
      if(!plain)continue;
      cells.splice(0,cells.length,plain[1],plain[2]+' '+(plain[3]||''),plain[4],plain[5]);
    }
    if (/^\d+[.)]?$/.test(cells[0]) && cells.length > 3) cells.shift();
    const description = cells.shift()!;
    if (!/[a-z]/i.test(description) || /^(description|item|particulars|quantity|invoice|purchase order|date)\b/i.test(description) && description.split(' ').length < 3) continue;
    const unit = cells.join(' ').match(/\b(kg|kgs|g|grams|packs?|pcs|units?)\b/i)?.[1]?.toLowerCase() || 'unit';
    const nums = cells.map(c=>c.replace(/(?:₹|Rs\.?|INR|kg|kgs|grams|packs?|pcs|units?)\s*/gi,'').replace(/,/g,'').trim()).filter(c=>/^\d+(?:\.\d+)?$/.test(c));
    if(nums.length<2) continue;
    result.push({description:description.slice(0,500),quantity:nums[0],cost:nums[1],unit:/^kg/.test(unit)?'kg':/^(g|grams)$/.test(unit)?'g':/^pack/.test(unit)?'pack':'unit'});
    if(result.length>=100)break;
  }
  return result;
}
export async function extractPdf(file: File) {
  if (!file.size || file.size > 4*1024*1024) throw new HttpError(400,'Choose a PDF up to 4 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if(!Buffer.from(bytes.slice(0,5)).equals(Buffer.from('%PDF-')))throw new HttpError(400,'Choose a valid PDF');
  let doc;
  try {
    doc = await getDocumentProxy(bytes.slice());
    if(doc.numPages>30)throw new HttpError(400,'Upload at most 30 pages at a time');
    const rows:string[]=[];
    for(let n=1;n<=doc.numPages;n++){
      const page=await doc.getPage(n);const content=await page.getTextContent();
      const groups=new Map<number,{x:number;text:string}[]>();
      for(const item of content.items){if(!('str' in item))continue;const y=Math.round(item.transform[5]/3)*3;const list=groups.get(y)||[];list.push({x:item.transform[4],text:item.str});groups.set(y,list);}
      for(const [,items] of [...groups].sort((a,b)=>b[0]-a[0])) rows.push(items.sort((a,b)=>a.x-b.x).map(i=>i.text).join('  '));
      if(rows.join('\n').length>200000)throw new HttpError(400,'This PDF contains too much text; split it into smaller files');
    }
    const text=rows.join('\n');
    return {bytes, text, lines:parseRows(rows), warning:text.trim()?'Verify quantities, prices and units against the PDF before saving.':'This PDF is scanned or has no readable text. Enter the items manually; OCR is not configured.'};
  } catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'This PDF could not be read. Remove password protection or export a text-based PDF.');}
  finally{await doc?.loadingTask.destroy();}
}
