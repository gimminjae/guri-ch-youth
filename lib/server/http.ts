import "server-only";
import { AppError, LIMITS, object, uuid } from "@/lib/domain";
import { inspectWorkbook, previewWorkbook } from "./excel/service";
import { writeWorkbook, type ExportSnapshot } from "./excel/workbook";
import { EXCEL_LIMITS } from "./excel/zip-guard";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Database } from "./database";
import type { ObjectStorage } from "./storage/types";
import { configuredAppOrigin } from "./config";
import { changePassword, cookieValue, getActor, login, logout, requireRole, sessionCookie } from "./auth";
import { cleanupFiles, downloadFile, uploadFile } from "./files";
import { deleteField, deletePrayer, getPrayer, listFields, manageFields, queryPrayers, saveField, savePrayer, setFieldActive } from "./repository";

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
export function checkOrigin(request: Request, configuredOrigin = configuredAppOrigin()) {
  if (["GET", "HEAD"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const expected = configuredOrigin ? new URL(configuredOrigin).origin : process.env.NODE_ENV !== "production" ? new URL(request.url).origin : null;
  if (!expected || origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") throw new AppError(403, "요청 출처를 확인할 수 없습니다.", "INVALID_ORIGIN");
}
async function readBody(request: Request, limit: number) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > limit) throw new AppError(413, "요청 크기가 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.length;
    if (total > limit) { await reader.cancel(); throw new AppError(413, "요청 크기가 너무 큽니다."); }
    chunks.push(part.value);
  }
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
async function bodyJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError(415, "JSON 형식으로 요청해주세요.");
  const bytes = await readBody(request, 512 * 1024);
  try { return object(JSON.parse(new TextDecoder().decode(bytes))); } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "입력 형식이 올바르지 않습니다.");
  }
}
export function createHandler(db: Database, storage: ObjectStorage, options: { origin?: string } = {}) {
  return async function handle(request: Request, path: string[]): Promise<Response> {
    try {
      const [resource, id] = path;
      const appOrigin = new URL(configuredAppOrigin(options.origin) || request.url).origin;
      if (path.length > 2) throw new AppError(404, "요청을 찾을 수 없습니다.");
      if (resource === "maintenance" && request.method === "POST" && !id) {
        const secret = process.env.CRON_SECRET;
        const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
        const supplied = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
        if (!secret || secret.length < 32 || !timingSafeEqual(expected, supplied)) throw new AppError(403, "접근할 수 없습니다.");
        return json(await cleanupFiles(db, storage, secret));
      }
      checkOrigin(request, options.origin);
      if (resource === "session" && !id && request.method === "POST") {
        const result = await login(db, await bodyJson(request));
        return json({ role: result.role }, 200, { "Set-Cookie": sessionCookie(result.token) });
      }
      const actor = await getActor(db, cookieValue(request));
      if (resource === "session" && !id) {
        if (request.method === "GET") return json({ role: actor?.role ?? null });
        if (request.method === "DELETE") { await logout(db, actor); return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) }); }
      }
      if (resource === "excel" && id === "download" && request.method === "POST") {
        const body = await bodyJson(request);
        const snapshot: ExportSnapshot = body.template === true ? { fields: await listFields(db, actor), items: [], summaries: [], groups: [], total: 0, fieldRevision: "" } : await db.rpc("export", body, actor?.token);
        const file = await writeWorkbook(snapshot, appOrigin, body.template === true);
        return new Response(file, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="prayers${body.template === true ? "-template" : ""}.xlsx"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      }
      if (resource === "prayers" && id === "summary" && request.method === "POST") return json(await db.rpc("summary", await bodyJson(request), actor?.token));
      // Public reads still use the validated RPC; mutations require a session below.
      if (resource === "fields" && !id && request.method === "GET") return json({ fields: await listFields(db, actor) });
      if (resource === "prayers" && id === "query" && request.method === "POST") return json(await queryPrayers(db, actor, await bodyJson(request)));
      if (resource === "prayers" && id && request.method === "GET") return json(await getPrayer(db, actor, uuid(id)));
      if (resource === "files" && id && request.method === "GET") {
        const result = await downloadFile(db, storage, actor, uuid(id));
        const inline = result.mime.startsWith("image/");
        return new Response(Buffer.from(result.bytes), { headers: { "Content-Type": result.mime, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(result.name).replace(/'/g, "%27")}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
      }
      const member = requireRole(actor);
      if (resource === "excel") {
        requireRole(member, ["admin", "sub-admin"]);
        if (id === "commit" && request.method === "POST") return json(await db.rpc("import_commit", await bodyJson(request), member.token));
        if ((id === "inspect" || id === "preview") && request.method === "POST") {
          const bytes = await readBody(request, EXCEL_LIMITS.fileBytes + 65536);
          let form: FormData;
          try { form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData(); } catch { throw new AppError(400, "엑셀 파일 요청을 확인해주세요."); }
          const file = form.get("file");
          if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) throw new AppError(400, ".xlsx 파일을 선택해주세요.");
          const fileBytes = new Uint8Array(await file.arrayBuffer());
          if (id === "inspect") return json(await inspectWorkbook(db, member, fileBytes));
          let settings: unknown;
          try { settings = JSON.parse(String(form.get("settings"))); } catch { throw new AppError(400, "열 연결과 업로드 모드를 확인해주세요."); }
          return json(await previewWorkbook(db, member, fileBytes, settings, appOrigin));
        }
      }
      if (resource === "fields") {
        requireRole(member, ["admin"]);
        if (id === "manage" && request.method === "GET") return json({ fields: await manageFields(db, member) });
        if (id === "order" && request.method === "PUT") return json(await db.rpc("reorder_fields", await bodyJson(request), member.token));
        if (id && request.method === "PATCH") return json(await setFieldActive(db, member, uuid(id), await bodyJson(request)));
        if (!id && request.method === "POST") return json(await saveField(db, member, await bodyJson(request)), 201);
        if (id && request.method === "PUT") return json(await saveField(db, member, await bodyJson(request), uuid(id)));
        if (id && request.method === "DELETE") { await deleteField(db, member, uuid(id), (await bodyJson(request)).updateDateTime); return json({ ok: true }); }
      }
      if (resource === "prayers") {
        if (!id && request.method === "POST") {
          return json(await savePrayer(db, member, await bodyJson(request)), 201);
        }
        requireRole(member, ["admin", "sub-admin"]);
        if (id && request.method === "PUT") return json(await savePrayer(db, member, await bodyJson(request), uuid(id)));
        if (id && request.method === "DELETE") { await deletePrayer(db, member, uuid(id), (await bodyJson(request)).updateDateTime); return json({ ok: true }); }
      }
      if (resource === "passwords" && !id && request.method === "PUT") {
        requireRole(member, ["admin"]);
        const body = await bodyJson(request);
        await changePassword(db, member, body);
        return json({ ok: true, signedOut: body.role === member.role }, 200, body.role === member.role ? { "Set-Cookie": sessionCookie("", 0) } : {});
      }
      if (resource === "uploads" && !id && request.method === "POST") {
        const bytes = await readBody(request, LIMITS.fileBytes + 65536);
        let form: FormData;
        try { form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData(); } catch { throw new AppError(400, "첨부파일 요청을 확인해주세요."); }
        const file = form.get("file");
        if (!(file instanceof File)) throw new AppError(400, "첨부파일을 선택해주세요.");
        return json(await uploadFile(db, storage, member, uuid(form.get("fieldId")), file), 201);
      }
      throw new AppError(404, "요청을 찾을 수 없습니다.");
    } catch (error) {
      if (error instanceof AppError) return json({ error: error.message, code: error.code }, error.status);
      // Provider errors may contain connection details. Never return them to clients.
      console.error("Prayer API request failed", { category: error instanceof Error ? error.name : "UnknownError" });
      return json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.", code: "SERVER_ERROR" }, 500);
    }
  };
}
