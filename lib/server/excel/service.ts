import "server-only";
import { AppError, fieldRevision, isChoice, isFile, isMulti, object, uuid, validateContent, type Actor, type Content, type Field } from "@/lib/domain";
import type { ExcelInspection, ExcelPreview } from "@/lib/excel-types";
import type { Database } from "../database";
import { listFields } from "../repository";
import { readWorkbook, SYSTEM_COLUMNS, type ParsedCell, type ParsedWorkbook } from "./workbook";
export async function inspectWorkbook(db: Database, actor: Actor, bytes: Uint8Array): Promise<ExcelInspection> {
  const [parsed, fields] = await Promise.all([readWorkbook(bytes), listFields(db, actor)]);
  return { fields, rowCount: parsed.rows.length, columns: parsed.headers.map((header) => ({ header, suggested: suggest(parsed, header, fields) })), samples: parsed.rows.slice(0, 3).map((row) => row.map((cell) => typeof cell === "object" && cell ? cell.date.slice(0, 10) : cell)) };
}
function suggest(parsed: ParsedWorkbook, header: string, fields: Field[]) {
  const matches = parsed.metadata.filter(([name]) => name === header);
  if (matches.length === 1 && (fields.some((f) => f.id === matches[0][1]) || Object.hasOwn(SYSTEM_COLUMNS, matches[0][1]))) return matches[0][1];
  return fields.find((f) => f.name === header)?.id ?? "";
}
function normalize(field: Field, cell: ParsedCell, mode: string, origin: string): Content[string] | null | undefined {
  if (cell === null || cell === "") return isFile(field.datatype) && mode === "update" ? undefined : null;
  if (isFile(field.datatype)) {
    if (mode === "add") throw new Error("첨부파일은 새 자료에 넣을 수 없습니다.");
    const url = new URL(String(cell));
    if (url.origin !== origin || !/^\/api\/files\/[a-f0-9-]+$/i.test(url.pathname) || url.search || url.hash) throw new Error("기존 첨부파일 링크만 유지할 수 있습니다.");
    return uuid(url.pathname.split("/").at(-1));
  }
  let value: Content[string];
  if (field.datatype === "number") {
    if (typeof cell !== "number" && (typeof cell !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.trim()))) throw new Error("숫자를 입력해주세요.");
    value = Number(cell);
  } else if (field.datatype === "bool") {
    if (typeof cell === "boolean") value = cell;
    else if (typeof cell === "string" && /^(true|false|예|아니오)$/i.test(cell.trim())) value = /^(true|예)$/i.test(cell.trim());
    else throw new Error("TRUE/FALSE 또는 예/아니오를 입력해주세요.");
  } else if (field.datatype === "date") {
    if (typeof cell === "object") value = cell.date.slice(0, 10);
    else if (typeof cell === "string") value = cell.trim();
    else throw new Error("YYYY-MM-DD 또는 날짜 셀을 사용해주세요.");
  } else {
    if (typeof cell === "object") throw new Error("날짜 셀은 날짜 필드에만 연결해주세요.");
    value = String(cell);
    if (isChoice(field.datatype)) value = isMulti(field.datatype) ? value.split(",").map((v) => v.trim()).filter(Boolean).join(",") : value.trim();
  }
  if (typeof value === "string" && !value.trim()) return null;
  const checked = validateContent({ [field.id]: value }, [field]);
  return checked[field.id] ?? null;
}
export async function previewWorkbook(db: Database, actor: Actor, bytes: Uint8Array, raw: unknown, origin: string): Promise<ExcelPreview> {
  const input = object(raw), parsed = await readWorkbook(bytes), fields = await listFields(db, actor);
  if (input.fieldRevision !== fieldRevision(fields)) throw new AppError(409, "필드 구성이 바뀌었습니다. 파일을 다시 선택해주세요.", "FIELDS_CHANGED");
  if (input.mode !== "add" && input.mode !== "update") throw new AppError(400, "추가 또는 수정 모드를 선택해주세요.");
  if (!Array.isArray(input.mapping) || input.mapping.length !== parsed.headers.length || input.mapping.some((v) => typeof v !== "string" || v && !Object.hasOwn(SYSTEM_COLUMNS, v) && !fields.some((f) => f.id === v))) throw new AppError(400, "열 연결을 확인해주세요.");
  const mapping = input.mapping as string[], targets = mapping.filter(Boolean);
  if (!targets.some((id) => fields.some((f) => f.id === id)) || new Set(targets).size !== targets.length) throw new AppError(400, "한 필드에는 하나의 열만 연결할 수 있습니다.");
  if (input.mode === "update" && (!targets.includes("__id") || !targets.includes("__version"))) throw new AppError(400, "기존 자료 수정에는 ID와 수정 버전 열이 필요합니다.");
  const errors: ExcelPreview["errors"] = [];
  const rows = parsed.rows.map((row, rowIndex) => {
    const result: { content: Record<string, Content[string] | null>; id?: string; updateDateTime?: string; listdisplaydata?: string[] } = { content: {} };
    mapping.forEach((target, column) => {
      if (!target) return;
      const cell = row[column] ?? null;
      try {
        if (target === "__id") { if (cell !== null && cell !== "") result.id = uuid(cell); }
        else if (target === "__version") { if (cell !== null && cell !== "") { if (typeof cell !== "string") throw new Error("내려받은 수정 버전 문자열을 유지해주세요."); result.updateDateTime = cell; } }
        else if (target === "__display") {
          if (cell === null || cell === "") { if (input.mode === "update") result.listdisplaydata = []; }
          else { const value = JSON.parse(String(cell)); if (!Array.isArray(value) || value.length > 40) throw new Error("목록 표시 필드 형식을 확인해주세요."); result.listdisplaydata = value.map(uuid); }
        } else {
          const field = fields.find((f) => f.id === target)!;
          const value = normalize(field, cell, input.mode as string, origin);
          if (value !== undefined) result.content[field.id] = value;
        }
      } catch (error) { errors.push({ row: rowIndex + 2, message: `${parsed.headers[column]}: ${error instanceof Error ? error.message : "값을 확인해주세요."}` }); }
    });
    return result;
  });
  if (errors.length) return { jobId: null, mode: input.mode, count: rows.length, errors, rows: [] };
  const payload = { mode: input.mode, rows, fieldRevision: fieldRevision(fields) };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 500 * 1024) throw new AppError(413, "변환한 데이터가 저장 요청 한도 512KiB에 가깝거나 초과합니다. 파일을 나누어주세요.");
  return db.rpc("import_preview", payload, actor.token);
}
