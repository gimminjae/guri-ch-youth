import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { requiredEnv } from "../config";
import type { ObjectStorage } from "./types";

let client: S3Client | undefined;
function s3() {
  if (!client) {
    client = new S3Client({
      region: requiredEnv("NEXT_PUBLIC_AWS_REGION"),
      credentials: {
        accessKeyId: requiredEnv("NEXT_PUBLIC_AWS_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnv("NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}
// Use long-term IAM keys explicitly; ignore ambient session tokens and profiles.
// No SDK, bucket, credentials, object keys, or S3 URLs cross into client modules.
export const storage: ObjectStorage = {
  async put(key, bytes, mime) {
    await s3().send(new PutObjectCommand({ Bucket: requiredEnv("S3_BUCKET"), Key: key, Body: bytes, ContentType: mime, IfNoneMatch: "*" }));
  },
  async get(key) {
    const response = await s3().send(new GetObjectCommand({ Bucket: requiredEnv("S3_BUCKET"), Key: key }));
    if (!response.Body) throw new Error("Empty storage response");
    return response.Body.transformToByteArray();
  },
  async remove(key) { await s3().send(new DeleteObjectCommand({ Bucket: requiredEnv("S3_BUCKET"), Key: key })); },
};
