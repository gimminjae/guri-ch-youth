import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHandler } from "../lib/server/http";
import { fieldRevision, type Actor, type Content, type Field, type Prayer, type Role } from "../lib/domain";
import { listFields, saveField, savePrayer, queryPrayers } from "../lib/server/repository";
import { login, getActor } from "../lib/server/auth";
import { cleanupFiles } from "../lib/server/files";
import { testDatabase, MemoryStorage, TEST_PASSWORDS, TEST_SECRET } from "./helpers";

test("PostgreSQL and API integration", async (t) => {
  const { pg, db } = await testDatabase();
  t.after(() => pg.close());
  const storage = new MemoryStorage();
  const handler = createHandler(db, storage, { origin: "http://localhost:3000" });
  const sessions = {} as Record<Role, { token: string; role: Role }>;
  for (const role of ["member", "sub-admin", "admin"] as const) sessions[role] = await login(db, { role, password: TEST_PASSWORDS[role] });
  const actor = (role: Role): Promise<Actor> => getActor(db, sessions[role].token) as Promise<Actor>;
  async function call(path: string, method = "GET", body?: unknown, role?: Role, headers: Record<string, string> = {}) {
    const multipart = body instanceof FormData;
    const request = new Request(`http://localhost:3000/api/${path}`, { method, headers: { Origin: "http://localhost:3000", ...(body !== undefined && !multipart ? { "Content-Type": "application/json" } : {}), ...(role ? { Cookie: `guri_session=${sessions[role].token}` } : {}), ...headers }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
    return handler(request, path.split("/"));
  }
  let fields: Field[] = [];
  let text: Field, multi: Field, num: Field, bool: Field, date: Field, image: Field;
  let prayer: Prayer;
  const payload = (content: Content, extra = {}) => ({ content, listdisplaydata: Object.keys(content), fieldRevision: fieldRevision(fields), ...extra });

  await t.test("public reads work while anonymous and forged-cookie mutations are denied", async () => {
    assert.equal((await call("fields")).status, 200);
    assert.equal((await call("prayers/query", "POST", { filters: [], page: 1 })).status, 200);
    for (const path of [`prayers/${randomUUID()}`, `files/${randomUUID()}`]) assert.equal((await call(path)).status, 404);
    const writes = [["fields", "POST"], [`fields/${randomUUID()}`, "PUT"], [`fields/${randomUUID()}`, "DELETE"], ["prayers", "POST"], [`prayers/${randomUUID()}`, "PUT"], [`prayers/${randomUUID()}`, "DELETE"], ["uploads", "POST"], ["passwords", "PUT"]];
    for (const cookie of ["", "guri_session=admin", `guri_session=${"a".repeat(64)}`]) {
      assert.equal((await call("fields", "GET", undefined, undefined, { Cookie: cookie })).status, 200);
      for (const [path, method] of writes) assert.equal((await call(path, method, {}, undefined, { Cookie: cookie })).status, 401);
    }
    assert.equal((await call("fields", "POST", {}, "admin", { Origin: "https://untrusted.example" })).status, 403);
    assert.equal((await call("prayers/query", "POST", { filters: [] }, undefined, { Origin: "https://untrusted.example" })).status, 403);
    assert.equal((await call("fields")).headers.get("cache-control"), "private, no-store");
  });
  await t.test("only admin manages fields and settings", async () => {
    const input = { name: "기도 내용", datatype: "string", displaytype: ["bold"], option: [], isGroupable: true, isFilterable: true };
    for (const role of ["member", "sub-admin"] as const) assert.equal((await call("fields", "POST", input, role)).status, 403);
    const response = await call("fields", "POST", input, "admin"); assert.equal(response.status, 201); text = await response.json();
    const admin = await actor("admin");
    multi = await saveField(db, admin, { ...input, name: "분류", datatype: "selectmultibox", option: ["학업", "진로", "가정"] });
    num = await saveField(db, admin, { ...input, name: "숫자", datatype: "number" });
    bool = await saveField(db, admin, { ...input, name: "응답", datatype: "bool" });
    date = await saveField(db, admin, { ...input, name: "날짜", datatype: "date" });
    image = await saveField(db, admin, { ...input, name: "이미지", datatype: "image" });
    fields = await listFields(db, await actor("member"));
    assert.equal((await call(`fields/${text.id}`, "PUT", { ...text, isGroupable: false }, "sub-admin")).status, 403);
  });
  await t.test("members create and read content; false and zero survive JSON and SQL", async () => {
    const response = await call("prayers", "POST", payload({ [text.id]: "시험, 진로를 위해 기도해주세요.", [multi.id]: "학업,진로", [num.id]: 0, [bool.id]: false, [date.id]: "2026-10-05" }), "member");
    assert.equal(response.status, 201, await response.clone().text()); prayer = await response.json();
    assert.equal(prayer.content[num.id], 0); assert.equal(prayer.content[bool.id], false);
    assert.deepEqual(await (await call(`prayers/${prayer.id}`)).json(), prayer);
    assert.equal((await (await call("fields")).json()).fields.length, fields.length);
    assert.equal((await call("prayers", "POST", payload({ badKey: "bad" }), "member")).status, 409);
  });
  await t.test("sub-admin updates content, member cannot, and concurrent edits conflict", async () => {
    const input = payload({ ...prayer.content, [text.id]: "수정한 기도, 진로" }, { updateDateTime: prayer.updateDateTime });
    assert.equal((await call(`prayers/${prayer.id}`, "PUT", input, "member")).status, 403);
    const update = await call(`prayers/${prayer.id}`, "PUT", input, "sub-admin"); assert.equal(update.status, 200); prayer = await update.json();
    assert.equal((await call(`prayers/${prayer.id}`, "PUT", input, "admin")).status, 409);
    assert.equal((await call(`prayers/${prayer.id}`, "DELETE", { updateDateTime: prayer.updateDateTime }, "member")).status, 403);
  });
  await t.test("used fields/options are protected; renaming preserves data", async () => {
    assert.equal((await call(`fields/${text.id}`, "DELETE", { updateDateTime: text.updateDateTime }, "admin")).status, 409);
    assert.equal((await call(`fields/${text.id}`, "PUT", { ...text, datatype: "number" }, "admin")).status, 409);
    assert.equal((await call(`fields/${multi.id}`, "PUT", { ...multi, option: ["학업"] }, "admin")).status, 409);
    const response = await call(`fields/${text.id}`, "PUT", { ...text, name: "나누고 싶은 기도" }, "admin"); assert.equal(response.status, 200); text = await response.json();
    const oldRevision = fieldRevision(fields); fields = await listFields(db, await actor("member"));
    assert.equal((await call("prayers", "POST", { ...payload({ [text.id]: "old form" }), fieldRevision: oldRevision }, "member")).status, 409);
    const read = await (await call(`prayers/${prayer.id}`, "GET", undefined, "member")).json(); assert.equal(read.content[text.id], "수정한 기도, 진로");
  });
  await t.test("public grouping/filtering spans pages and deduplicates multi-select totals", async () => {
    const member = await actor("member");
    for (let i = 1; i <= 25; i++) { if (i === 15) await db.query("DELETE FROM prayer_private.rate_limits"); await savePrayer(db, member, payload({ [text.id]: `기도 ${i}`, [multi.id]: i <= 15 ? "학업" : "가정", [num.id]: i, [bool.id]: true, [date.id]: "2026-10-06" })); }
    await savePrayer(db, member, payload({ [text.id]: "미입력 분류" }));
    const list = await queryPrayers(db, null, { filters: [], page: 2 }); assert.equal(list.total, 27); assert.equal(list.items.length, 12); assert.equal(list.pages, 3);
    const group = await queryPrayers(db, null, { groupBy: multi.id, filters: [], page: 1 });
    assert.equal(group.total, 27); assert.equal(group.groups.find((g) => g.key === "학업")?.count, 16); assert.equal(group.groups.find((g) => g.key === "진로")?.count, 1); assert.equal(group.groups.find((g) => g.key === null)?.count, 1); assert.equal(group.groups.reduce((sum, g) => sum + g.count, 0), 28);
    const secondGroupPage = await queryPrayers(db, null, { groupBy: multi.id, groupKey: "학업", filters: [], page: 2 }); assert.equal(secondGroupPage.items.length, 4);
    const combined = await queryPrayers(db, null, { groupBy: multi.id, filters: [{ fieldId: multi.id, op: "in", value: ["학업", "가정"] }, { fieldId: num.id, op: "range", min: 14, max: 17 }], page: 1 });
    assert.equal(combined.total, 4); assert.deepEqual(combined.groups.map((g) => g.count), [2, 2]);
    const falseFilter = await queryPrayers(db, null, { filters: [{ fieldId: bool.id, op: "eq", value: false }] }); assert.equal(falseFilter.total, 1);
    const zero = await queryPrayers(db, null, { filters: [{ fieldId: num.id, op: "eq", value: 0 }] }); assert.equal(zero.total, 1);
    const dateRange = await queryPrayers(db, null, { filters: [{ fieldId: date.id, op: "range", min: "2026-10-05", max: "2026-10-05" }] }); assert.equal(dateRange.total, 1);
    const injection = await queryPrayers(db, null, { filters: [{ fieldId: text.id, op: "contains", value: "' OR 1=1 --" }] }); assert.equal(injection.total, 0);
    const numericGroups = await queryPrayers(db, null, { groupBy: num.id, filters: [], page: 1 }); assert.equal(numericGroups.groups[2].key, "2"); assert.equal(numericGroups.groupPages, 3);
  });
  await t.test("disabled group/filter settings are enforced server-side", async () => {
    const response = await call(`fields/${bool.id}`, "PUT", { ...bool, isGroupable: false, isFilterable: false }, "admin"); assert.equal(response.status, 200); bool = await response.json(); fields = await listFields(db, await actor("member"));
    assert.equal((await call("prayers/query", "POST", { groupBy: bool.id, filters: [] }, "member")).status, 409);
    assert.equal((await call("prayers/query", "POST", { filters: [{ fieldId: bool.id, op: "eq", value: false }] }, "member")).status, 409);
  });
  await t.test("only published attachments are public; pending uploads remain session-owned", async () => {
    const form = new FormData(); form.set("fieldId", image.id);
    form.set("file", new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ysAAAAASUVORK5CYII=", "base64")], "기도.png", { type: "image/png" }));
    const upload = await call("uploads", "POST", form, "member"); assert.equal(upload.status, 201, await upload.clone().text());
    const file = await upload.json(); assert.ok(file.id); assert.equal(file.objectKey, undefined); assert.equal(file.url, undefined);
    assert.equal((await call(`files/${file.id}`)).status, 404);
    assert.equal((await call(`files/${file.id}`, "GET", undefined, "sub-admin")).status, 404);
    assert.equal((await call(`files/${file.id}`, "GET", undefined, "member")).status, 200);
    assert.equal((await call("prayers", "POST", payload({ [image.id]: file.id }), "sub-admin")).status, 400);
    const created = await call("prayers", "POST", payload({ [text.id]: "이미지 기도", [image.id]: file.id }), "member"); assert.equal(created.status, 201); const saved: Prayer = await created.json();
    assert.equal((await call(`files/${file.id}`, "GET", undefined, "sub-admin")).status, 200);
    const publicFile = await call(`files/${file.id}`); assert.equal(publicFile.status, 200); assert.equal(publicFile.headers.get("content-type"), "image/png");
    assert.ok((await publicFile.arrayBuffer()).byteLength > 0);
    assert.equal((await call("prayers", "POST", payload({ [image.id]: file.id }), "member")).status, 400);
    storage.failRemove = true;
    assert.equal((await call(`prayers/${saved.id}`, "DELETE", { updateDateTime: saved.updateDateTime }, "sub-admin")).status, 200);
    assert.equal((await call(`files/${file.id}`, "GET", undefined, "member")).status, 404);
    assert.equal((await call(`files/${file.id}`)).status, 404);
    assert.equal((await cleanupFiles(db, storage, TEST_SECRET)).pending, 1);
    storage.failRemove = false; assert.equal((await cleanupFiles(db, storage, TEST_SECRET)).removed, 1); assert.equal(storage.files.size, 0);
    const bad = new FormData(); bad.set("fieldId", image.id); bad.set("file", new File(["<script>alert('x')</script>"], "fake.png", { type: "image/png" }));
    assert.equal((await call("uploads", "POST", bad, "member")).status, 400);
    const truncated = new FormData(); truncated.set("fieldId", image.id);
    truncated.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "broken.png", { type: "image/png" }));
    assert.equal((await call("uploads", "POST", truncated, "member")).status, 400);
  });
  await t.test("pending files cannot bypass a later change to an image field", async () => {
    const fileField = await saveField(db, await actor("admin"), { name: "첨부 자료", datatype: "file", option: [], displaytype: [], isGroupable: false, isFilterable: false });
    const form = new FormData(); form.set("fieldId", fileField.id);
    form.set("file", new File(["%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"], "자료.pdf", { type: "application/pdf" }));
    const uploaded = await call("uploads", "POST", form, "member"); assert.equal(uploaded.status, 201);
    const asset = await uploaded.json();
    assert.equal((await call(`fields/${fileField.id}`, "PUT", { ...fileField, datatype: "image" }, "admin")).status, 200);
    fields = await listFields(db, await actor("member"));
    const response = await call("prayers", "POST", payload({ [fileField.id]: asset.id }), "member");
    assert.equal(response.status, 400);
    assert.match(await response.text(), /이미지 파일/);
  });
  await t.test("database roles cannot bypass the application through exposed tables", async () => {
    const result = await db.query<{ role: string; allowed: boolean }>(`SELECT rolname AS role, has_table_privilege(rolname, 'public.praycontent', 'SELECT') AS allowed FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`);
    assert.equal(result.rows.length, 3); assert.ok(result.rows.every((row) => !row.allowed));
    const rls = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('praycontent','praycontentfield')"); assert.ok(rls.rows.every((r) => r.relrowsecurity));
    const hashes = await db.query<{ pw: string }>("SELECT pw FROM prayer_private.password"); assert.ok(hashes.rows.every((r) => r.pw.startsWith("bcrypt-sha256:") && !Object.values(TEST_PASSWORDS).includes(r.pw)));
  });
  await t.test("direct publishable-key RPC callers cannot bypass roles or input validation", async () => {
    assert.equal((await db.rpc<Field[]>("fields")).length, fields.length);
    for (const action of ["save_field", "delete_field", "save_prayer", "delete_prayer", "password", "upload_begin", "upload_finish", "upload_fail"]) {
      for (const token of ["", "f".repeat(64)]) await assert.rejects(db.rpc(action, { role: "admin" }, token), { status: 401 });
    }
    await assert.rejects(db.rpc("save_field", text, sessions.member.token), { status: 403 });
    await assert.rejects(db.rpc("delete_field", { id: text.id }, sessions["sub-admin"].token), { status: 403 });
    await assert.rejects(db.rpc("password", { role: "admin", password: "untrusted-password" }, sessions["sub-admin"].token), { status: 403 });
    await assert.rejects(db.rpc("save_prayer", { ...payload(prayer.content), id: prayer.id, role: "admin", updateDateTime: prayer.updateDateTime }, sessions.member.token), { status: 403 });
    await assert.rejects(db.rpc("save_prayer", payload({ [num.id]: "0" }), sessions.member.token), { status: 400 });
    await assert.rejects(db.rpc("save_prayer", payload({ [text.id]: "text" }, { listdisplaydata: [`${text.id},${num.id}`] }), sessions.member.token), { status: 400 });
    await assert.rejects(db.rpc("save_field", { name: "잘못된 필드", datatype: "html", option: [], displaytype: [], isGroupable: false, isFilterable: false }, sessions.admin.token), { status: 400 });
    await assert.rejects(db.rpc("query", { filters: [{ fieldId: num.id, op: "range", min: 10, max: 0 }] }, sessions.member.token), { status: 400 });
    await assert.rejects(db.rpc("cleanup_list", {}, sessions.admin.token), { status: 403 });
    await assert.rejects(db.rpc("execute_sql", { sql: "SELECT pw FROM prayer_private.password" }, sessions.admin.token), { status: 404 });
    await assert.rejects(pg.transaction(async (tx) => { await tx.exec("SET LOCAL ROLE anon"); await tx.exec("SELECT * FROM prayer_private.password"); }), /permission denied/);
    await assert.rejects(pg.transaction(async (tx) => { await tx.exec("SET LOCAL ROLE anon"); await tx.exec("SELECT prayer_private.password_hash('untrusted-password')"); }), /permission denied/);
    const functions = await db.query<{ name: string; definer: boolean; publicExecute: boolean }>(`SELECT p.proname AS name,p.prosecdef AS definer,has_function_privilege('anon',p.oid,'EXECUTE') AS "publicExecute" FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prayer_private'`);
    assert.deepEqual(functions.rows.filter((f) => f.publicExecute).map((f) => f.name), ["dispatch"]);
  });
  await t.test("password changes and login accept short, long, Unicode and whitespace values exactly", async () => {
    for (const password of ["1", "  한글'! ♥  ", "길이제한없음!".repeat(100)]) {
      assert.equal((await call("passwords", "PUT", { role: "member", password }, "admin")).status, 200);
      assert.equal((await call("session", "POST", { role: "member", password })).status, 200);
      assert.equal((await call("session", "POST", { role: "member", password: password + "x" })).status, 401);
      sessions.member = await login(db, { role: "member", password });
    }
    assert.equal((await call("session", "POST", { role: "member", password: 123 })).status, 400);
    const result = await db.query<{ hashed: boolean }>("SELECT pw LIKE 'bcrypt-sha256:%' AS hashed FROM prayer_private.password");
    assert.ok(result.rows.every((row) => row.hashed));
  });
  await t.test("password rotation, tampering, expiration, and logout revoke access", async () => {
    assert.equal((await call("passwords", "PUT", { role: "member", password: "replacement-password-123" }, "sub-admin")).status, 403);
    assert.equal((await call("passwords", "PUT", { role: "member", password: "replacement-password-123" }, "admin")).status, 200);
    assert.equal((await call("fields", "GET", undefined, "member")).status, 200);
    assert.equal((await call("prayers", "POST", payload({}), "member")).status, 401);
    assert.equal(await getActor(db, "f".repeat(64)), null);
    const expired = await login(db, { role: "admin", password: TEST_PASSWORDS.admin });
    await db.query('UPDATE prayer_private.sessions SET "expiresAt"=now()-interval \'1 second\' WHERE token_hash=encode(sha256(convert_to($1,\'UTF8\')),\'hex\')', [expired.token]);
    assert.equal(await getActor(db, expired.token), null);
    assert.equal((await call("session", "DELETE", undefined, "sub-admin")).status, 200);
    assert.equal((await call("fields", "GET", undefined, "sub-admin")).status, 200);
    assert.equal((await call("prayers", "POST", payload({}), "sub-admin")).status, 401);
  });
  await t.test("login rate limits are durable and wrong passwords never grant a role", async () => {
    await db.query("DELETE FROM prayer_private.rate_limits");
    for (let i = 0; i < 10; i++) assert.equal((await call("session", "POST", { role: "admin", password: "wrong-password" })).status, 401);
    assert.equal((await call("session", "POST", { role: "admin", password: TEST_PASSWORDS.admin })).status, 429);
  });
});
