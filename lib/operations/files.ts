import { getSupabaseAdmin } from "../supabase/admin";
import { HttpError } from "../http";
const bucket = "operations-private";
export async function putFile(key: string, bytes: Uint8Array, type: string) {
  const storage = getSupabaseAdmin().storage;
  const { data } = await storage.getBucket(bucket);
  if (!data) {
    const { error } = await storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: 10485760,
    });
    if (error && !/exists/i.test(error.message))
      throw new HttpError(503, "Private file storage is unavailable");
  }
  const { error } = await storage
    .from(bucket)
    .upload(key, bytes, { contentType: type, upsert: false });
  if (error)
    throw new HttpError(
      503,
      "File upload failed. Check private storage configuration",
    );
}
export async function fileLink(key: string) {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(key, 60, { download: true });
  if (error || !data) throw new HttpError(503, "Could not retrieve file");
  return data.signedUrl;
}
export async function removeFile(key: string) {
  await getSupabaseAdmin().storage.from(bucket).remove([key]);
}
