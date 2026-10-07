import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdir, readFile } from "node:fs/promises";
import { unwrapRpc, type Database, type RpcResult } from "../lib/server/database";
import type { ObjectStorage } from "../lib/server/storage/types";

export const TEST_PASSWORDS = { member: "member-test-only-123", "sub-admin": "sub-admin-test-only-123", admin: "admin-test-only-123" };
export const TEST_SECRET = "local-test-only-secret-with-at-least-32-characters";
export function wrapDatabase(pg: PGlite) {
  return {
    async query<T>(sql: string, values: unknown[] = []) { const result = await pg.query<T>(sql, values); return { rows: result.rows, rowCount: result.affectedRows }; },
    async rpc<T>(action: string, payload = {}, token = ""): Promise<T> {
      // Match the actual PostgREST role, not the migration owner's privileges.
      return pg.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE anon");
        const { rows } = await tx.query<{ result: RpcResult<T> }>("SELECT public.prayer_api($1,$2::jsonb,$3) AS result", [action, JSON.stringify(payload), token]);
        // Do not throw before COMMIT: failed-login counters must survive errors.
        return rows[0].result;
      }).then(unwrapRpc<T>);
    },
  } satisfies Database & { query: unknown };
}
export async function testDatabase() {
  const pg = new PGlite({ extensions: { pgcrypto }, parsers: { 1184: (value) => value } });
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  for (const name of (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) await pg.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  const db = wrapDatabase(pg);
  for (const [role, password] of Object.entries(TEST_PASSWORDS)) await db.query("INSERT INTO prayer_private.password (id,pw) VALUES ($1,prayer_private.password_hash($2))", [role, password]);
  await db.query("INSERT INTO prayer_private.settings(key,value) VALUES ('cron_hash',encode(sha256(convert_to($1,'UTF8')),'hex'))", [TEST_SECRET]);
  return { db, pg };
}
export class MemoryStorage implements ObjectStorage {
  files = new Map<string, Uint8Array>();
  failRemove = false;
  async put(key: string, bytes: Uint8Array) { if (this.files.has(key)) throw new Error("Already exists"); this.files.set(key, bytes); }
  async get(key: string) { const bytes = this.files.get(key); if (!bytes) throw new Error("Not found"); return bytes; }
  async remove(key: string) { if (this.failRemove) throw new Error("Simulated storage outage"); this.files.delete(key); }
}
