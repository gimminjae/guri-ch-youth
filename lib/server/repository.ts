import "server-only";
import { object, uuid, validateField, type Actor, type Field, type ListResult, type Prayer } from "@/lib/domain";
import type { Database } from "./database";
import { requireRole } from "./auth";

export async function listFields(db: Database, actor: Actor | null = null): Promise<Field[]> {
  return db.rpc("fields", {}, actor?.token);
}
export async function saveField(db: Database, actor: Actor, raw: unknown, id?: string): Promise<Field> {
  requireRole(actor, ["admin"]);
  const input = validateField(raw), payload = object(raw);
  return db.rpc("save_field", { ...input, ...(id ? { id: uuid(id), updateDateTime: payload.updateDateTime } : {}) }, actor.token);
}
export async function deleteField(db: Database, actor: Actor, id: string, version: unknown) {
  requireRole(actor, ["admin"]);
  return db.rpc("delete_field", { id: uuid(id), updateDateTime: version }, actor.token);
}
export async function getPrayer(db: Database, actor: Actor | null, id: string): Promise<Prayer> {
  return db.rpc("prayer", { id: uuid(id) }, actor?.token);
}
export async function savePrayer(db: Database, actor: Actor, raw: unknown, id?: string): Promise<Prayer> {
  requireRole(actor, id ? ["admin", "sub-admin"] : undefined);
  return db.rpc("save_prayer", { ...object(raw), ...(id ? { id: uuid(id) } : {}) }, actor.token);
}
export async function deletePrayer(db: Database, actor: Actor, id: string, version: unknown) {
  requireRole(actor, ["admin", "sub-admin"]);
  return db.rpc("delete_prayer", { id: uuid(id), updateDateTime: version }, actor.token);
}
export async function queryPrayers(db: Database, actor: Actor | null, raw: unknown): Promise<ListResult> {
  return db.rpc("query", object(raw), actor?.token);
}
