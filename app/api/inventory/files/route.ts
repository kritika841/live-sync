import { randomUUID, createHash } from "node:crypto";
import { access } from "../../../../lib/operations/access";
import { operationsDb } from "../../../../lib/operations/schema";
import { audit } from "../../../../lib/operations/inventory";
import {
  putFile,
  fileLink,
  removeFile,
} from "../../../../lib/operations/files";
import {
  errorResponse,
  required,
  quantity,
  HttpError,
} from "../../../../lib/http";
export async function GET(r: Request) {
  try {
    await access(r);
    const db = await operationsDb();
    const row = await db
      .prepare("SELECT storage_key FROM supplier_invoices WHERE id=?")
      .bind(new URL(r.url).searchParams.get("id"))
      .first<{ storage_key: string }>();
    if (!row) throw new HttpError(404, "Invoice not found");
    return Response.redirect(await fileLink(row.storage_key));
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(r: Request) {
  let key = "";
  try {
    const u = await access(r);
    const f = await r.formData();
    const file = f.get("file");
    if (!(file instanceof File) || !file.size || file.size > 4 * 1024 * 1024)
      throw new HttpError(400, "Choose an invoice file up to 4 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const header = Buffer.from(bytes.slice(0, 8));
    const type = header.toString().startsWith("%PDF-")
      ? "application/pdf"
      : header[0] === 137 && header.toString("ascii", 1, 4) === "PNG"
        ? "image/png"
        : header[0] === 255 && header[1] === 216
          ? "image/jpeg"
          : "";
    if (!type)
      throw new HttpError(400, "Only PDF, PNG and JPEG invoices are supported");
    const db = await operationsDb();
    const po = await db
      .prepare("SELECT id,supplier_id FROM purchase_orders WHERE id=?")
      .bind(required(f.get("poId"), "PO"))
      .first<{ id: string; supplier_id: string }>();
    if (!po) throw new HttpError(404, "PO not found");
    const number = required(f.get("number"), "Invoice number"),
      amount = quantity(f.get("amount"), "Amount", true);
    const id = randomUUID();
    key = `invoices/${id}`;
    await putFile(key, bytes, type);
    await db.transaction(async (sql) => {
      await sql`INSERT INTO supplier_invoices(id,supplier_id,purchase_order_id,invoice_number,invoice_date,storage_key,original_filename,file_hash,status,grand_total,created_by,created_at,updated_at) VALUES(${id},${po.supplier_id},${po.id},${number},${String(f.get("date") || "")},${key},${file.name.slice(0, 200)},${createHash("sha256").update(bytes).digest("hex")},'review_required',${amount},${u.email},${new Date().toISOString()},${new Date().toISOString()})`;
      await audit(sql, u, "invoice_uploaded", id, {
        poId: po.id,
        number,
        amount,
      });
    });
    key = "";
    return Response.json({ id });
  } catch (e) {
    if (key) await removeFile(key).catch(() => {});
    return errorResponse(e);
  }
}
