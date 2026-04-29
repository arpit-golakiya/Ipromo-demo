import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";

const region = (process.env.AWS_REGION ?? "us-east-2").replace(/^"|"$/g, "");
const bucket = (process.env.S3_BUCKET_NAME ?? "merchai-onboarding").replace(/^"|"$/g, "");

export const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: (process.env.AWS_ACCESS_KEY_ID ?? "").replace(/^"|"$/g, ""),
    secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY ?? "").replace(/^"|"$/g, ""),
  },
});

/**
 * Upload a Buffer to S3 and return its public HTTPS URL.
 *
 * @param buf         File contents
 * @param folder      S3 key prefix, e.g. "brand-logos" or "lookbooks/previews"
 * @param prefix      Filename prefix, e.g. "brand-v1" or "lookbook"
 * @param ext         File extension without dot, e.g. "png" or "pdf"
 * @param contentType MIME type for the Content-Type header
 */
export async function uploadToS3(
  buf: Buffer,
  folder: string,
  prefix: string,
  ext: string,
  contentType: string,
): Promise<string> {
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `${folder}/${prefix}-${timestamp}-${id}.${ext}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buf,
      ContentType: contentType,
    }),
  );

  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}
