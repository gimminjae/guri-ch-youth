import "server-only";
import { fileTypeFromBuffer } from "file-type";
import { AppError, LIMITS, isFile, type Actor } from "@/lib/domain";
import type { Database } from "./database";
import type { ObjectStorage } from "./storage/types";
import { listFields } from "./repository";
import { requireRole } from "./auth";

const allowedImages = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const allowedFiles = [...allowedImages, "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"];
type Asset = { id: string; objectKey: string; name: string; mime: string; size: number };
export async function uploadFile(db: Database, storage: ObjectStorage, actor: Actor, fieldId: string, file: File) {
  requireRole(actor);
  const field = (await listFields(db, actor)).find((f) => f.id === fieldId);
  if (!field || !isFile(field.datatype)) throw new AppError(400, "파일을 첨부할 항목을 확인해주세요.");
  if (file.size < 1 || file.size > LIMITS.fileBytes) throw new AppError(400, "첨부파일은 4MB 이하로 올려주세요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let type;
  try { type = await fileTypeFromBuffer(bytes); } catch { throw new AppError(400, "파일을 읽을 수 없습니다. 올바른 파일인지 확인해주세요."); }
  if (!type || !(field.datatype === "image" ? allowedImages : allowedFiles).includes(type.mime)) throw new AppError(400, "허용된 이미지·문서 파일을 올려주세요.");
  const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) || `attachment.${type.ext}`;
  const asset = await db.rpc<Asset>("upload_begin", { fieldId, name, mime: type.mime, size: bytes.length }, actor.token);
  try {
    await storage.put(asset.objectKey, bytes, type.mime);
    await db.rpc("upload_finish", { id: asset.id }, actor.token);
  } catch (error) {
    // The uploading row also expires if the failure update cannot reach Supabase.
    await db.rpc("upload_fail", { id: asset.id }, actor.token).catch(() => undefined);
    throw error;
  }
  return { id: asset.id, name, mime: type.mime, size: bytes.length };
}
export async function downloadFile(db: Database, storage: ObjectStorage, actor: Actor | null, id: string) {
  const asset = await db.rpc<Asset>("file", { id }, actor?.token);
  return { bytes: await storage.get(asset.objectKey), name: asset.name, mime: asset.mime };
}
export async function cleanupFiles(db: Database, storage: ObjectStorage, workerToken: string) {
  const assets = await db.rpc<Asset[]>("cleanup_list", {}, workerToken);
  let removed = 0;
  for (const asset of assets) {
    try { await storage.remove(asset.objectKey); await db.rpc("cleanup_ack", { id: asset.id }, workerToken); removed++; }
    catch { /* Keep the durable queue row for the next scheduled retry. */ }
  }
  return { removed, pending: assets.length - removed };
}
