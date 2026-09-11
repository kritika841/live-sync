import {createHash,randomUUID} from 'node:crypto';
import {access} from '../../../../lib/operations/access';
import {extractPdf} from '../../../../lib/operations/pdf';
import {commitDocument, type Review} from '../../../../lib/operations/documents';
import {putFile,removeFile,fileLink} from '../../../../lib/operations/files';
import {operationsDb} from '../../../../lib/operations/schema';
import {HttpError,errorResponse} from '../../../../lib/http';
export const maxDuration=60;
export async function GET(r:Request){try{await access(r);const db=await operationsDb();const row=await db.prepare('SELECT storage_key FROM procurement_documents WHERE entity_id=?').bind(new URL(r.url).searchParams.get('id')).first<{storage_key:string}>();if(!row)throw new HttpError(404,'Document not found');return Response.redirect(await fileLink(row.storage_key));}catch(e){return errorResponse(e);}}
export async function POST(r:Request){let key='';try{
 const u=await access(r);if(Number(r.headers.get('content-length')||0)>4.3*1024*1024)throw new HttpError(413,'Choose a PDF up to 4 MB');
 const form=await r.formData(),file=form.get('file');if(!(file instanceof File))throw new HttpError(400,'Choose a PDF');
 const extracted=await extractPdf(file);
 if(!form.get('review'))return Response.json({lines:extracted.lines,text:extracted.text,warning:extracted.warning});
 let review:Review;try{review=JSON.parse(String(form.get('review')));}catch{throw new HttpError(400,'Invalid document review');}
 key='documents/'+randomUUID();await putFile(key,extracted.bytes,'application/pdf');
 const result=await commitDocument(review,{key,hash:createHash('sha256').update(extracted.bytes).digest('hex'),name:file.name.slice(0,200),text:extracted.text},u);key='';return Response.json(result);
}catch(e){if(key)await removeFile(key).catch(()=>{});return errorResponse(e);}}
