import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { fieldRevision, type Actor, type Field, type Prayer, type ListResult, type Role } from "../lib/domain";
import { createHandler } from "../lib/server/http";
import { cleanupFiles } from "../lib/server/files";
import { inspectWorkbook, previewWorkbook } from "../lib/server/excel/service";
import { writeWorkbook, type ExportSnapshot } from "../lib/server/excel/workbook";
import { testDatabase, wrapDatabase, MemoryStorage, TEST_PASSWORDS, TEST_SECRET } from "./helpers";
import { PATCH } from "../app/api/[...path]/route";

const migrationName = "20261009020025_field_lifecycle.sql";
test("Next route exposes PATCH and rejects cross-origin field changes before accessing the DB", async () => {
  const response = await PATCH(new Request("http://localhost:3000/api/fields/test", {
    method: "PATCH", headers: { "sec-fetch-site": "cross-site" },
  }), { params: Promise.resolve({ path: ["fields", "test"] }) });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "INVALID_ORIGIN");
});

test("field lifecycle preserves disabled values and deletes only inactive fields", async (t) => {
  const { db, pg } = await testDatabase(); t.after(() => pg.close());
  const storage = new MemoryStorage(), origin = "http://localhost:3000";
  const handler = createHandler(db, storage, { origin });
  const actors = {} as Record<Role, Actor>;
  for (const role of ["member", "sub-admin", "admin"] as const) {
    const { token } = await db.rpc<{ token: string }>("login", { role, password: TEST_PASSWORDS[role] });
    actors[role] = { ...(await db.rpc<Actor>("session", {}, token)), token };
  }
  const rpc = <T>(action: string, body = {}, role: Role = "admin") => db.rpc<T>(action, body, actors[role].token);
  const call = (path: string, method = "GET", body?: unknown, role?: Role, requestOrigin = origin) => handler(new Request(`${origin}/api/${path}`, {
    method, headers: { Origin: requestOrigin, "Content-Type": "application/json", ...(role ? { Cookie: `guri_session=${actors[role].token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path.split("/"));
  const make = (name: string, datatype: Field["datatype"]) => rpc<Field>("save_field", { name, datatype, option: [], displaytype: [], isGroupable: true, isFilterable: true, isAggregatable: true });
  const active = await make("사용할 내용", "string");
  let hidden = await make("미사용할 내용", "string"), file = await make("문서", "file");
  const fields = () => db.rpc<Field[]>("fields");
  const revision = async () => fieldRevision(await fields());
  const toggle = (field: Field, isActive: boolean) => rpc<Field>("set_field_active", { id: field.id, updateDateTime: field.updateDateTime, isActive });
  const startUpload = () => rpc<{ id: string; objectKey: string }>("upload_begin", { fieldId: file.id, name: "test.pdf", mime: "application/pdf", size: 12 });
  const attached = await startUpload(); await storage.put(attached.objectKey, new Uint8Array(12));
  await rpc("upload_finish", { id: attached.id });
  let prayer = await rpc<Prayer>("save_prayer", { content: { [active.id]: "원래 내용", [hidden.id]: "보존할 내용", [file.id]: attached.id }, listdisplaydata: [hidden.id, active.id, file.id], fieldRevision: await revision() });
  const original = prayer, oldRevision = await revision();
  const workbook = await writeWorkbook(await db.rpc<ExportSnapshot>("export", { filters: [] }), origin);

  await t.test("state changes, private metadata and deletion are admin-only and versioned", async () => {
    assert.equal(hidden.isActive, true);
    for (const role of [undefined, "member", "sub-admin"] as const) {
      const status = role ? 403 : 401;
      assert.equal((await call("fields/manage", "GET", undefined, role)).status, status);
      assert.equal((await call(`fields/${hidden.id}`, "PATCH", { isActive: false, updateDateTime: hidden.updateDateTime }, role)).status, status);
      assert.equal((await call(`fields/${hidden.id}`, "DELETE", { updateDateTime: hidden.updateDateTime }, role)).status, status);
      await assert.rejects(db.rpc("manage_fields", {}, role ? actors[role].token : ""), { status });
      await assert.rejects(db.rpc("set_field_active", { ...hidden, isActive: false }, role ? actors[role].token : ""), { status });
    }
    assert.equal((await call(`fields/${hidden.id}`, "PATCH", { isActive: false }, "admin", "https://untrusted.example")).status, 403);
    for (const isActive of [null, "false", 0]) await assert.rejects(rpc("set_field_active", { ...hidden, isActive }), { status: 400 });
    await assert.rejects(rpc("delete_field", hidden), { status: 409 });
    const before = hidden;
    const response = await call(`fields/${hidden.id}`, "PATCH", { isActive: false, updateDateTime: hidden.updateDateTime }, "admin");
    assert.equal(response.status, 200); hidden = await response.json(); assert.equal(hidden.isActive, false);
    await assert.rejects(toggle(before, true), { status: 409 });
    await assert.rejects(rpc("delete_field", before), { status: 409 });
    const grants = await db.query<{ allowed: boolean }>("SELECT has_function_privilege('anon','prayer_private.set_field_active(jsonb)','EXECUTE') OR has_function_privilege('anon','prayer_private.delete_field(jsonb)','EXECUTE') AS allowed");
    assert.equal(grants.rows[0].allowed, false);
  });

  await t.test("inactive fields disappear from public values, filters, groups, summaries and XLSX", async () => {
    file = await toggle(file, false);
    assert.deepEqual((await fields()).map((f) => f.id), [active.id]);
    assert.equal((await (await call("fields/manage", "GET", undefined, "admin")).json()).fields.length, 3);
    assert.deepEqual((await db.rpc<Prayer>("prayer", { id: prayer.id })).content, { [active.id]: "원래 내용" });
    const page = await db.rpc<ListResult>("query", { filters: [] });
    assert.deepEqual(page.items[0].listdisplaydata, [active.id]);
    assert.deepEqual(page.summaries.map((s) => s.fieldId), [active.id]);
    for (const id of [hidden.id, file.id]) {
      await assert.rejects(db.rpc("query", { filters: [{ fieldId: id, op: "present" }] }), { status: 409 });
      await assert.rejects(db.rpc("query", { filters: [], groupBy: id }), { status: 409 });
      await assert.rejects(db.rpc("summary", { filters: [], summaryField: id }), { status: 409 });
      await assert.rejects(db.rpc("export", { filters: [], groupBy: id }), { status: 409 });
    }
    const snapshot = await db.rpc<ExportSnapshot>("export", { filters: [] });
    assert.deepEqual(snapshot.fields.map((f) => f.id), [active.id]); assert.deepEqual(snapshot.items[0].content, { [active.id]: "원래 내용" });
    const inspection = await inspectWorkbook(db, actors.admin, workbook);
    assert.deepEqual(inspection.fields.map((f) => f.id), [active.id]);
    assert.equal(inspection.columns.find((c) => c.header === hidden.name)?.suggested, "");
    await assert.rejects(previewWorkbook(db, actors.admin, workbook, { mode: "update", fieldRevision: await revision(), mapping: inspection.columns.map((c) => c.header === hidden.name ? hidden.id : c.suggested) }, origin), { status: 400 });
    await assert.rejects(db.rpc("file", { id: attached.id }), { status: 404 });
    await assert.rejects(startUpload(), { status: 400 });
    assert.equal(storage.files.has(attached.objectKey), true);
    await assert.rejects(rpc("save_prayer", { ...original, fieldRevision: oldRevision }), { status: 409 });
    await assert.rejects(rpc("save_prayer", { ...original, fieldRevision: await revision() }), { status: 409 });
    await assert.rejects(rpc("save_prayer", { content: { [active.id]: "값" }, listdisplaydata: [hidden.id], fieldRevision: await revision() }), { status: 400 });
  });

  await t.test("ordinary and bulk edits preserve inactive values and attachments; reactivation restores them", async () => {
    prayer = await rpc<Prayer>("save_prayer", { ...prayer, content: { [active.id]: "일반 수정" }, listdisplaydata: [active.id], fieldRevision: await revision() }, "sub-admin");
    let raw = (await db.query<Prayer>('SELECT content,listdisplaydata FROM public.praycontent WHERE id=$1', [prayer.id])).rows[0];
    assert.equal(raw.content[hidden.id], "보존할 내용"); assert.equal(raw.content[file.id], attached.id);
    const preview = await rpc<{ jobId: string; errors: unknown[] }>("import_preview", { mode: "update", fieldRevision: await revision(), rows: [{ id: prayer.id, updateDateTime: prayer.updateDateTime, content: { [active.id]: "엑셀 수정" } }] }, "sub-admin");
    assert.deepEqual(preview.errors, []); await rpc("import_commit", { jobId: preview.jobId }, "sub-admin");
    raw = (await db.query<Prayer>('SELECT content FROM public.praycontent WHERE id=$1', [prayer.id])).rows[0];
    assert.equal(raw.content[active.id], "엑셀 수정"); assert.equal(raw.content[hidden.id], "보존할 내용"); assert.equal(raw.content[file.id], attached.id);
    hidden = await toggle(hidden, true); file = await toggle(file, true);
    prayer = await db.rpc<Prayer>("prayer", { id: prayer.id });
    assert.equal(prayer.content[hidden.id], "보존할 내용"); assert.equal(prayer.content[file.id], attached.id);
    assert.ok(prayer.listdisplaydata.includes(hidden.id)); assert.ok(prayer.listdisplaydata.includes(file.id));
    assert.equal((await db.rpc<{ id: string }>("file", { id: attached.id })).id, attached.id);
    assert.equal(hidden.isAggregatable, true); assert.equal(hidden.isFilterable, true);
  });

  await t.test("state changes invalidate import previews; field order includes inactive fields", async () => {
    const preview = await rpc<{ jobId: string }>("import_preview", { mode: "update", fieldRevision: await revision(), rows: [{ id: prayer.id, updateDateTime: prayer.updateDateTime, content: { [active.id]: "오래된 미리보기" } }] });
    hidden = await toggle(hidden, false);
    await assert.rejects(rpc("import_commit", { jobId: preview.jobId }), { status: 409 });
    const invalid = await rpc<{ jobId: null; errors: unknown[] }>("import_preview", { mode: "add", fieldRevision: await revision(), rows: [{ content: { [active.id]: "값", [hidden.id]: "숨은 값" } }] });
    assert.equal(invalid.jobId, null); assert.equal(invalid.errors.length, 1);
    const all = await rpc<Field[]>("manage_fields");
    await assert.rejects(rpc("reorder_fields", { ids: (await fields()).map((f) => f.id), fieldRevision: await revision() }), { status: 409 });
    await rpc("reorder_fields", { ids: [...all].reverse().map((f) => f.id), fieldRevision: fieldRevision(all) });
    const reordered = await rpc<Field[]>("manage_fields");
    assert.deepEqual(reordered.map((f) => f.id), [...all].reverse().map((f) => f.id));
    hidden = reordered.find((f) => f.id === hidden.id)!; file = reordered.find((f) => f.id === file.id)!;
  });

  await t.test("deletion removes only the target values, invalidates edited rows, and queues files with retries", async () => {
    const pending = await startUpload(); await storage.put(pending.objectKey, new Uint8Array(12)); await rpc("upload_finish", { id: pending.id });
    const inFlight = await startUpload();
    file = await toggle(file, false);
    const before = await db.rpc<Prayer>("prayer", { id: prayer.id });
    const deletion = await rpc<{ affectedPrayers: number }>("delete_field", hidden);
    assert.equal(deletion.affectedPrayers, 1);
    let raw = (await db.query<{ content: Prayer["content"]; listdisplaydata: string; updateDateTime: string }>('SELECT content,listdisplaydata,"updateDateTime" FROM public.praycontent WHERE id=$1', [prayer.id])).rows[0];
    assert.equal(raw.content[hidden.id], undefined); assert.equal(raw.content[active.id], "엑셀 수정"); assert.ok(!raw.listdisplaydata.includes(hidden.id));
    assert.notEqual(raw.updateDateTime, before.updateDateTime);
    const stale = await call(`prayers/${prayer.id}`, "PUT", { ...before, fieldRevision: await revision() }, "admin"); assert.equal(stale.status, 409);
    await rpc("delete_field", file);
    raw = (await db.query<typeof raw>('SELECT content,listdisplaydata,"updateDateTime" FROM public.praycontent WHERE id=$1', [prayer.id])).rows[0];
    assert.deepEqual(raw.content, { [active.id]: "엑셀 수정" }); assert.equal(raw.listdisplaydata, active.id);
    await assert.rejects(db.rpc("file", { id: attached.id }), { status: 404 });
    await assert.rejects(toggle(file, true), { status: 404 });
    // The PUT may finish after the field is deleted; keep its retry row until fail/expiry.
    assert.equal((await db.query<{ state: string }>('SELECT state FROM prayer_private.assets WHERE id=$1', [inFlight.id])).rows[0].state, "uploading");
    await storage.put(inFlight.objectKey, new Uint8Array(12));
    await assert.rejects(rpc("upload_finish", { id: inFlight.id }), { status: 409 });
    await rpc("upload_fail", { id: inFlight.id });
    storage.failRemove = true; assert.equal((await cleanupFiles(db, storage, TEST_SECRET)).pending, 3);
    storage.failRemove = false; assert.equal((await cleanupFiles(db, storage, TEST_SECRET)).removed, 3); assert.equal(storage.files.size, 0);
    assert.equal((await db.query('SELECT id FROM public.praycontent WHERE id=$1', [prayer.id])).rows.length, 1);
  });
});

test("field lifecycle migration upgrades existing data and safely reapplies with inactive fields", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } }); t.after(() => pg.close());
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  for (const name of (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql") && f < migrationName).sort()) await pg.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  const db = wrapDatabase(pg);
  await pg.exec("INSERT INTO prayer_private.password(id,pw) VALUES ('admin',prayer_private.password_hash('x'))");
  const { token } = await db.rpc<{ token: string }>("login", { role: "admin", password: "x" });
  let field = await db.rpc<Field>("save_field", { name: "기존 항목", datatype: "string", option: [], displaytype: [], isGroupable: false, isFilterable: false }, token);
  const prayer = await db.rpc<Prayer>("save_prayer", { fieldRevision: fieldRevision([field]), content: { [field.id]: "보존" }, listdisplaydata: [field.id] }, token);
  const migration = await readFile(`supabase/migrations/${migrationName}`, "utf8"); await pg.exec(migration);
  field = (await db.rpc<Field[]>("fields"))[0]; assert.equal(field.isActive, true); assert.deepEqual(await db.rpc("prayer", { id: prayer.id }), prayer);
  field = await db.rpc<Field>("set_field_active", { ...field, isActive: false }, token);
  await pg.exec(migration);
  assert.deepEqual(await db.rpc("fields"), []); assert.equal((await db.rpc<Field[]>("manage_fields", {}, token))[0].isActive, false);
  assert.equal((await db.rpc<{ role: string }>("session", {}, token)).role, "admin");
  field = await db.rpc<Field>("set_field_active", { ...field, isActive: true }, token);
  assert.deepEqual(await db.rpc("prayer", { id: prayer.id }), prayer);
  assert.equal((await db.rpc<{ version: number }>("health")).version, 5);
});
