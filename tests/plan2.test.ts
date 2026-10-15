import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testDatabase, MemoryStorage, TEST_PASSWORDS } from "./helpers";
import { fieldRevision, type Actor, type Field, type Prayer, type ListResult, type Summary } from "../lib/domain";
import { randomUUID } from "node:crypto";
import { createHandler } from "../lib/server/http";
import { readWorkbook, writeWorkbook, type ExportSnapshot } from "../lib/server/excel/workbook";
import { inspectWorkbook, previewWorkbook } from "../lib/server/excel/service";
import { guardXlsx } from "../lib/server/excel/zip-guard";
import type { ExcelPreview } from "../lib/excel-types";

const origin = "http://localhost:3000";
test("plan2 grid settings, full-result counts and transactional XLSX", async (t) => {
  const { db, pg } = await testDatabase(); t.after(() => pg.close());
  const actors: Record<string, Actor> = {};
  for (const role of ["admin", "sub-admin", "member"] as const) {
    const result = await db.rpc<{ token: string }>("login", { role, password: TEST_PASSWORDS[role] });
    const session = await db.rpc<{ sessionId: string }>("session", {}, result.token);
    actors[role] = { role, token: result.token, sessionId: session.sessionId };
  }
  const admin = actors.admin;
  const rpc = <T>(action: string, payload = {}, actor = admin) => db.rpc<T>(action, payload, actor.token);
  const make = async (name: string, datatype: Field["datatype"], extra = {}) => rpc<Field>("save_field", { name, datatype, option: [], displaytype: [], isGroupable: true, isFilterable: true, isAggregatable: true, optionColors: {}, ...extra });
  let name = await make("이름", "shorttext"), prose = await make("기도", "string");
  const choice = await make("분류", "checkbox", { option: ["학업", "진로", "가정"], optionColors: { 학업: "#abcdef", 진로: "#e8792a" }, displaytype: ["badge", "color"] });
  const number = await make("숫자", "number"), bool = await make("확인", "bool"), date = await make("날짜", "date"), file = await make("문서", "file");
  let fields = await rpc<Field[]>("fields");
  let prayer: Prayer;
  await t.test("field order is complete, atomic, versioned and admin-only; colors reject CSS", async () => {
    assert.equal(choice.optionColors.학업, "#ABCDEF");
    await assert.rejects(rpc("save_field", { ...choice, optionColors: { 가짜: "#AABBCC" } }));
    await assert.rejects(rpc("save_field", { ...choice, optionColors: { 학업: "url(evil)" } }));
    await assert.rejects(rpc("reorder_fields", { ids: fields.map((f) => f.id), fieldRevision: fieldRevision(fields) }, actors["sub-admin"]), { status: 403 });
    await assert.rejects(rpc("reorder_fields", { ids: [name.id, name.id], fieldRevision: fieldRevision(fields) }), { status: 400 });
    const rev = fieldRevision(fields), ids = [...fields].reverse().map((f) => f.id);
    await rpc("reorder_fields", { ids, fieldRevision: rev });
    fields = await rpc<Field[]>("fields"); assert.deepEqual(fields.map((f) => f.id), ids);
    await assert.rejects(rpc("reorder_fields", { ids, fieldRevision: rev }), { status: 409 });
    name = fields.find((f) => f.id === name.id)!; prose = fields.find((f) => f.id === prose.id)!;
  });
  await t.test("short text conversion preserves content and blocks newline loss", async () => {
    prayer = await rpc<Prayer>("save_prayer", { fieldRevision: fieldRevision(fields), content: { [name.id]: "0012 한글", [prose.id]: "감사\n기도, 함께", [choice.id]: "학업,진로,학업", [number.id]: 0, [bool.id]: false, [date.id]: "2026-10-08" }, listdisplaydata: [choice.id, name.id] });
    await assert.rejects(rpc("save_field", { ...prose, datatype: "shorttext" }), { status: 409 });
    await assert.rejects(rpc("save_prayer", { fieldRevision: fieldRevision(fields), content: { [name.id]: "줄\n바꿈" }, listdisplaydata: [] }), { status: 400 });
    name = await rpc<Field>("save_field", { ...name, datatype: "string" });
    name = await rpc<Field>("save_field", { ...name, datatype: "shorttext" });
    fields = await rpc<Field[]>("fields");
    assert.equal((await rpc<Prayer>("prayer", { id: prayer.id })).content[name.id], "0012 한글");
  });
  await t.test("counts cover all filtered rows, zero options, exact text, multi values and group scopes", async () => {
    for (let i = 0; i < 26; i++) await db.query('INSERT INTO public.praycontent(content,listdisplaydata) VALUES ($1,$2)', [JSON.stringify({ [name.id]: `이름 ${i}`, [choice.id]: i < 16 ? "학업" : "진로", [number.id]: i + 1, [bool.id]: true }), name.id]);
    const page = await db.rpc<ListResult>("query", { filters: [], page: 2 }); assert.equal(page.items.length, 12); assert.equal(page.total, 27);
    const summary = page.summaries.find((s) => s.fieldId === choice.id)!;
    assert.equal(summary.values.find((v) => v.key === "학업")?.count, 17);
    assert.equal(summary.values.find((v) => v.key === "진로")?.count, 11);
    assert.equal(summary.values.find((v) => v.key === "가정")?.count, 0);
    assert.equal(summary.total, 27);
    const groups = await db.rpc<ListResult>("query", { filters: [], groupBy: choice.id, page: 1 });
    const study = groups.groups.find((g) => g.key === "학업")!;
    assert.equal(study.summaries.find((s) => s.fieldId === choice.id)?.values.find((v) => v.key === "진로")?.count, 1);
    const only = await db.rpc<ListResult>("query", { filters: [{ fieldId: name.id, op: "eq", value: "0012 한글" }] });
    assert.equal(only.total, 1); assert.equal(only.summaries.find((s) => s.fieldId === number.id)?.values.find((v) => v.key === "0")?.count, 1);
    assert.equal(only.summaries.find((s) => s.fieldId === bool.id)?.values.find((v) => v.key === "false")?.count, 1);
    assert.equal(page.summaries.find((s) => s.fieldId === name.id)?.pages, 3);
    const next = await db.rpc<Summary[]>("summary", { filters: [], summaryField: name.id, summaryPage: 2 }); assert.equal(next[0].values.length, 12);
    const exported = await db.rpc<ExportSnapshot>("export", { filters: [] });
    assert.equal(exported.summaries.find((s) => s.fieldId === name.id)?.values.length, 28);
    await assert.rejects(db.rpc("summary", { filters: [], summaryField: "bad" }), { status: 409 });
  });
  await t.test("public export is a filtered snapshot including hidden values, typed cells and ID metadata", async () => {
    const snapshot = await db.rpc<ExportSnapshot>("export", { filters: [{ fieldId: name.id, op: "eq", value: "0012 한글" }], groupBy: choice.id });
    assert.equal(snapshot.items.length, 1); assert.equal(snapshot.groups.length, 2);
    const bytes = await writeWorkbook(snapshot, origin);
    const parsed = await readWorkbook(bytes); assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0][fields.findIndex((f) => f.id === number.id)], 0);
    assert.equal(parsed.rows[0][fields.findIndex((f) => f.id === bool.id)], false);
    assert.equal(parsed.rows[0][fields.findIndex((f) => f.id === prose.id)], "감사\n기도, 함께");
    assert.equal(parsed.rows[0][fields.findIndex((f) => f.id === name.id)], "0012 한글");
    assert.deepEqual(parsed.rows[0][fields.findIndex((f) => f.id === date.id)], { date: "2026-10-08T00:00:00.000Z" });
    const inspection = await inspectWorkbook(db, admin, bytes);
    assert.deepEqual(inspection.columns.slice(0, fields.length).map((c) => c.suggested), fields.map((f) => f.id));
    const preview = await previewWorkbook(db, admin, bytes, { mode: "update", mapping: inspection.columns.map((c) => c.suggested), fieldRevision: fieldRevision(fields) }, origin);
    assert.equal(preview.errors.length, 0); assert.ok(preview.jobId);
    const accidentalAdd = await previewWorkbook(db, admin, bytes, { mode: "add", mapping: inspection.columns.map((c) => c.suggested), fieldRevision: fieldRevision(fields) }, origin);
    assert.match(accidentalAdd.errors[0].message, /ID/);
  });
  await t.test("bulk import preserves unmapped values, clears blanks, rejects attachments and cannot bypass permissions", async () => {
    const payload = { mode: "update", fieldRevision: fieldRevision(fields), rows: [{ id: prayer.id, updateDateTime: prayer.updateDateTime, content: { [name.id]: "수정한 이름", [number.id]: null } }] };
    await assert.rejects(rpc("import_preview", payload, actors.member), { status: 403 });
    await assert.rejects(db.rpc("import_preview", payload), { status: 401 });
    const preview = await rpc<ExcelPreview>("import_preview", payload, actors["sub-admin"]); assert.ok(preview.jobId); assert.deepEqual(preview.rows[0].cleared, [number.id]);
    await assert.rejects(rpc("import_commit", { jobId: preview.jobId }), { status: 409 });
    const first = await rpc("import_commit", { jobId: preview.jobId }, actors["sub-admin"]);
    const again = await rpc("import_commit", { jobId: preview.jobId }, actors["sub-admin"]); assert.deepEqual(again, first);
    prayer = await rpc<Prayer>("prayer", { id: prayer.id }); assert.equal(prayer.content[name.id], "수정한 이름"); assert.equal(prayer.content[number.id], undefined); assert.equal(prayer.content[prose.id], "감사\n기도, 함께");
    const bad = await rpc<ExcelPreview>("import_preview", { ...payload, rows: [{ id: prayer.id, updateDateTime: prayer.updateDateTime, content: { [file.id]: "00000000-0000-4000-8000-000000000001" } }] }); assert.equal(bad.jobId, null); assert.match(bad.errors[0].message, /첨부파일/);
  });
  await t.test("commit rechecks every version atomically and rechecks field revisions", async () => {
    const rows = await rpc<ListResult>("query", { filters: [], page: 1 }); const [a, b] = rows.items;
    const payload = { mode: "update", fieldRevision: fieldRevision(fields), rows: [a, b].map((p) => ({ id: p.id, updateDateTime: p.updateDateTime, content: { [name.id]: "일괄 수정" } })) };
    const preview = await rpc<ExcelPreview>("import_preview", payload); assert.ok(preview.jobId);
    await rpc("save_prayer", { ...b, content: { ...b.content, [name.id]: "외부 변경" }, fieldRevision: fieldRevision(fields) });
    await assert.rejects(rpc("import_commit", { jobId: preview.jobId }), { status: 409 });
    assert.equal((await rpc<Prayer>("prayer", { id: a.id })).content[name.id], a.content[name.id]);
    const add = await rpc<ExcelPreview>("import_preview", { mode: "add", fieldRevision: fieldRevision(fields), rows: [{ content: { [name.id]: "새 기도" } }] });
    await rpc("reorder_fields", { ids: fields.map((f) => f.id), fieldRevision: fieldRevision(fields) }); fields = await rpc<Field[]>("fields");
    await assert.rejects(rpc("import_commit", { jobId: add.jobId }), { status: 409 });
  });
  await t.test("preview rejects duplicate IDs and preserves only the original published attachment", async () => {
    const assetId = randomUUID();
    await db.query(`INSERT INTO prayer_private.assets(id,"objectKey","fieldId","prayerId","sessionId",name,mime,size,state) VALUES($1,$2,$3,$4,$5,'test.pdf','application/pdf',16,'attached')`, [assetId, `test/${assetId}`, file.id, prayer.id, admin.sessionId]);
    await db.query('UPDATE public.praycontent SET content=content||$1::jsonb WHERE id=$2', [JSON.stringify({ [file.id]: assetId }), prayer.id]);
    prayer = await rpc<Prayer>("prayer", { id: prayer.id });
    const row = { id: prayer.id, updateDateTime: prayer.updateDateTime, content: { [name.id]: "원본 첨부 유지", [file.id]: assetId } };
    const duplicate = await rpc<ExcelPreview>("import_preview", { mode: "update", fieldRevision: fieldRevision(fields), rows: [row, row] }); assert.equal(duplicate.jobId, null); assert.match(duplicate.errors[0].message, /중복/);
    const snapshot = await db.rpc<ExportSnapshot>("export", { filters: [{ fieldId: name.id, op: "eq", value: String(prayer.content[name.id]) }] });
    const bytes = await writeWorkbook(snapshot, origin), inspected = await inspectWorkbook(db, admin, bytes);
    const valid = await previewWorkbook(db, admin, bytes, { mode: "update", mapping: inspected.columns.map((c) => c.suggested), fieldRevision: fieldRevision(fields) }, origin); assert.ok(valid.jobId); assert.equal(valid.errors.length, 0);
    await rpc("import_commit", { jobId: valid.jobId });
    prayer = await rpc<Prayer>("prayer", { id: prayer.id }); assert.equal(prayer.content[file.id], assetId);
    const attached = await db.query<{ state: string }>("SELECT state FROM prayer_private.assets WHERE id=$1", [assetId]); assert.equal(attached.rows[0].state, "attached");
  });
  await t.test("bulk create uses separate limits and retry IDs prevent duplicates", async () => {
    const before = (await db.rpc<ListResult>("query", { filters: [] })).total;
    const preview = await rpc<ExcelPreview>("import_preview", { mode: "add", fieldRevision: fieldRevision(fields), rows: Array.from({ length: 25 }, (_, i) => ({ content: { [name.id]: `추가 ${i}`, [bool.id]: false } })) }); assert.ok(preview.jobId);
    await rpc("import_commit", { jobId: preview.jobId }); await rpc("import_commit", { jobId: preview.jobId });
    assert.equal((await db.rpc<ListResult>("query", { filters: [] })).total, before + 25);
    await assert.rejects(rpc("import_preview", { mode: "add", fieldRevision: fieldRevision(fields), rows: Array.from({ length: 501 }, () => ({ content: {} })) }), { status: 400 });
    await db.query('UPDATE prayer_private.import_jobs SET "expiresAt"=now()-interval \'1 minute\' WHERE id=$1', [preview.jobId]);
    await assert.rejects(rpc("import_commit", { jobId: preview.jobId }), { status: 409 });
    await assert.rejects(db.query("SET ROLE anon; SELECT * FROM prayer_private.import_jobs")); await db.query("RESET ROLE");
  });
  await t.test("multipart upload supports manual mapping, normalized values, preview and idempotent commit", async () => {
    const handler = createHandler(db, new MemoryStorage(), { origin });
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("기도부탁");
    sheet.addRow(["교인명", "내용", "수량", "확인 여부", "분류값", "모임일"]); sheet.addRow(["00123", "한글\n기도, 함께", "0", "아니오", "학업, 진로", "2026-10-08"]);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const post = async (endpoint: string, settings?: unknown) => {
      const form = new FormData(); form.set("file", new File([bytes], "test.xlsx")); if (settings) form.set("settings", JSON.stringify(settings));
      return handler(new Request(`${origin}/api/excel/${endpoint}`, { method: "POST", headers: { origin, cookie: `guri_session=${admin.token}` }, body: form }), ["excel", endpoint]);
    };
    const inspection = await post("inspect"); assert.equal(inspection.status, 200); assert.equal((await inspection.json()).columns[0].suggested, "");
    const settings = { mode: "add", mapping: [name.id, prose.id, number.id, bool.id, choice.id, date.id], fieldRevision: fieldRevision(fields) };
    const previewResponse = await post("preview", settings); assert.equal(previewResponse.status, 200);
    const preview: ExcelPreview = await previewResponse.json(); assert.ok(preview.jobId); assert.equal(preview.errors.length, 0); assert.equal(preview.rows[0].content[number.id], 0); assert.equal(preview.rows[0].content[bool.id], false); assert.equal(preview.rows[0].content[name.id], "00123");
    const commit = await handler(new Request(`${origin}/api/excel/commit`, { method: "POST", headers: { origin, cookie: `guri_session=${admin.token}`, "content-type": "application/json" }, body: JSON.stringify({ jobId: preview.jobId }) }), ["excel", "commit"]); assert.equal(commit.status, 200);
    const query = await db.rpc<ListResult>("query", { filters: [{ fieldId: name.id, op: "eq", value: "00123" }] }); assert.equal(query.total, 1); assert.equal(query.items[0].content[choice.id], "학업,진로");
    const duplicateMapping = await post("preview", { ...settings, mapping: [name.id, name.id, number.id, bool.id, choice.id, date.id] }); assert.equal(duplicateMapping.status, 400);
    const templateBytes = await writeWorkbook({ fields, items: [], summaries: [], groups: [], total: 0, fieldRevision: fieldRevision(fields) }, origin, true);
    const template = new ExcelJS.Workbook(); await template.xlsx.load(new Uint8Array(templateBytes).buffer);
    template.getWorksheet("기도부탁")!.addRow(fields.map((f) => f.id === name.id ? "양식 추가 테스트" : null));
    const filledBytes = Buffer.from(await template.xlsx.writeBuffer()), filled = await inspectWorkbook(db, admin, filledBytes);
    const fromTemplate = await previewWorkbook(db, admin, filledBytes, { mode: "add", mapping: filled.columns.map((c) => c.suggested), fieldRevision: fieldRevision(fields) }, origin); assert.ok(fromTemplate.jobId);
    await rpc("import_commit", { jobId: fromTemplate.jobId });
    const inserted = await db.rpc<ListResult>("query", { filters: [{ fieldId: name.id, op: "eq", value: "양식 추가 테스트" }] });
    assert.deepEqual(inserted.items[0].listdisplaydata, fields.map((f) => f.id));

  });
  await t.test("summary-only fields reject filters and trim outer whitespace without rewriting source", async () => {
    let field = fields.find((f) => f.id === prose.id)!;
    field = await rpc<Field>("save_field", { ...field, isGroupable: false, isFilterable: false, isAggregatable: true }); fields = await rpc<Field[]>("fields");
    const row = await rpc<Prayer>("save_prayer", { fieldRevision: fieldRevision(fields), listdisplaydata: [field.id], content: { [field.id]: "\n  요약 값 \t" } });
    const counts = await db.rpc<Summary[]>("summary", { filters: [], summaryField: field.id }); assert.equal(counts[0].values.find((v) => v.key === "요약 값")?.count, 1);
    assert.equal((await rpc<Prayer>("prayer", { id: row.id })).content[field.id], "\n  요약 값 \t");
    await assert.rejects(db.rpc("query", { filters: [{ fieldId: field.id, op: "eq", value: "요약 값" }] }), { status: 409 });
    await assert.rejects(db.rpc("query", { filters: [], groupBy: field.id }), { status: 409 });
    field = await rpc<Field>("save_field", { ...field, isAggregatable: false }); fields = await rpc<Field[]>("fields");
    await assert.rejects(db.rpc("summary", { filters: [], summaryField: field.id }), { status: 409 });
  });
  await t.test("HTTP Excel endpoints expose public downloads but protect parse/commit and origins", async () => {
    const handler = createHandler(db, new MemoryStorage(), { origin });
    const request = (resource: string, body: unknown, role?: string, requestOrigin = origin) => handler(new Request(`${origin}/api/${resource}`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json", ...(role ? { cookie: `guri_session=${actors[role].token}` } : {}) }, body: JSON.stringify(body) }), resource.split("/"));
    const download = await request("excel/download", { filters: [], template: true }); assert.equal(download.status, 200); assert.match(download.headers.get("content-type")!, /spreadsheet/); assert.equal((await readWorkbook(new Uint8Array(await download.arrayBuffer()))).rows.length, 0);
    assert.equal((await request("excel/inspect", {})).status, 401);
    assert.equal((await request("excel/commit", {}, "member")).status, 403);
    assert.equal((await request("excel/download", {}, undefined, "http://foreign.invalid")).status, 403);
  });
});

test("XLSX parsers reject formulas, links, merges, oversized input and typed data errors", async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("기도부탁"); sheet.addRow(["텍스트"]); sheet.addRow(["=HYPERLINK(\"https://example.com\")"]);
  let bytes = Buffer.from(await workbook.xlsx.writeBuffer()); guardXlsx(bytes); assert.equal((await readWorkbook(bytes)).rows[0][0], '=HYPERLINK("https://example.com")');
  sheet.getCell("A2").value = { formula: "1+1", result: 2 }; bytes = Buffer.from(await workbook.xlsx.writeBuffer()); assert.throws(() => guardXlsx(bytes), /수식/);
  sheet.getCell("A2").value = { text: "링크", hyperlink: "https://example.com" }; bytes = Buffer.from(await workbook.xlsx.writeBuffer()); assert.throws(() => guardXlsx(bytes));
  sheet.getCell("A2").value = "값"; sheet.mergeCells("A2:B2"); bytes = Buffer.from(await workbook.xlsx.writeBuffer()); assert.throws(() => guardXlsx(bytes));
  assert.throws(() => guardXlsx(new Uint8Array(5 * 1024 * 1024 + 1)), { status: 413 });
  assert.throws(() => guardXlsx(Buffer.from("not an XLSX")));
});

test("plan2 migration upgrades existing rows/sessions and can be reapplied without resetting order", async (t) => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { readFile, readdir } = await import("node:fs/promises");
  const { wrapDatabase } = await import("./helpers");
  const pg = new PGlite({ extensions: { pgcrypto } }); t.after(() => pg.close());
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  const files = (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql") && f <= "20261008045525_grid_summary_excel.sql").sort();
  for (const name of files.slice(0, -1)) await pg.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  const db = wrapDatabase(pg);
  await pg.exec("INSERT INTO prayer_private.password(id,pw) VALUES ('admin',prayer_private.password_hash('x'))");
  const { token } = await db.rpc<{ token: string }>("login", { role: "admin", password: "x" });
  const field = await db.rpc<Field>("save_field", { name: "기존 긴 글", datatype: "string", option: [], displaytype: [], isGroupable: true, isFilterable: true }, token);
  const prayer = await db.rpc<Prayer>("save_prayer", { fieldRevision: fieldRevision([field]), content: { [field.id]: "첫 줄\n둘째 줄" }, listdisplaydata: [field.id] }, token);
  const migration = await readFile(`supabase/migrations/${files.at(-1)}`, "utf8"); await pg.exec(migration);
  let fields = await db.rpc<Field[]>("fields"); assert.equal(fields[0].listOrder, 1); assert.deepEqual(fields[0].optionColors, {}); assert.equal(fields[0].isAggregatable, false);
  assert.deepEqual(await db.rpc("prayer", { id: prayer.id }), prayer);
  assert.equal((await db.rpc<{ role: string }>("session", {}, token)).role, "admin");
  await pg.exec('UPDATE public.praycontentfield SET "listOrder"=25');
  await pg.exec(migration); fields = await db.rpc<Field[]>("fields"); assert.equal(fields[0].listOrder, 25);
  assert.deepEqual(await db.rpc("prayer", { id: prayer.id }), prayer);
  assert.equal((await db.rpc<{ version: number }>("health")).version, 4);
});
