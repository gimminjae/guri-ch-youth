import "server-only";
import ExcelJS from "exceljs";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { AppError, TYPE_LABELS, isFile, type Field, type Group, type Prayer, type Summary } from "@/lib/domain";
import { EXCEL_LIMITS, guardXlsx } from "./zip-guard";
export type ParsedCell = string | number | boolean | null | { date: string };
export type ParsedWorkbook = { headers: string[]; rows: ParsedCell[][]; metadata: [string, string][] };
export type ExportSnapshot = { fields: Field[]; items: Prayer[]; total: number; groups: Group[]; summaries: Summary[]; fieldRevision: string };
export const SYSTEM_COLUMNS = { __id: "기도부탁 ID", __version: "수정 버전", __display: "목록 표시 필드" };
export async function readWorkbook(bytes: Uint8Array): Promise<ParsedWorkbook> {
  guardXlsx(bytes);
  return new Promise((resolve, reject) => {
    // Turbopack spreads workerData to add runtime globals. Keep binary data nested
    // so that its Uint8Array type survives that object spread in production builds.
    const worker = new Worker(path.join(process.cwd(), "lib/server/excel/parse-worker.mjs"), { workerData: { bytes }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new AppError(413, "엑셀 분석 시간이 초과되었습니다. 파일을 나누어주세요.")); }, EXCEL_LIMITS.timeoutMs);
    worker.once("message", (result: ParsedWorkbook & { error?: string }) => { clearTimeout(timer); void worker.terminate(); if (result.error) reject(new AppError(400, result.error)); else resolve(result); });
    worker.once("error", () => { clearTimeout(timer); reject(new AppError(400, "엑셀 파일을 읽지 못했습니다. 일반 .xlsx 형식과 파일 크기를 확인해주세요.")); });
    worker.once("exit", (code) => { clearTimeout(timer); if (code !== 0) reject(new AppError(400, "엑셀 파일 분석을 완료하지 못했습니다.")); });
  });
}
export async function writeWorkbook(snapshot: ExportSnapshot, origin: string, template = false) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = "구리교회 청년회";
  const data = workbook.addWorksheet("기도부탁", { views: [{ state: "frozen", ySplit: 1 }] });
  const meta = workbook.addWorksheet("_기도_설정", { state: "veryHidden" });
  meta.addRow(["guri-prayer-v1", snapshot.fieldRevision]);
  const headers = [...snapshot.fields.map((f) => f.name), ...Object.values(SYSTEM_COLUMNS)];
  data.addRow(headers);
  snapshot.fields.forEach((f, i) => { meta.addRow([f.name, f.id]); data.getColumn(i + 1).width = f.datatype === "string" ? 48 : 22; });
  Object.entries(SYSTEM_COLUMNS).forEach(([key, name], i) => { meta.addRow([name, key]); data.getColumn(snapshot.fields.length + i + 1).hidden = true; });
  if (!template) snapshot.items.forEach((p) => {
    const values = snapshot.fields.map((f) => {
      const v = p.content[f.id];
      if (v === undefined) return null;
      if (isFile(f.datatype)) return `${origin}/api/files/${v}`;
      if (f.datatype === "date") return new Date(`${v}T00:00:00.000Z`);
      return v;
    });
    const row = data.addRow([...values, p.id, p.updateDateTime, JSON.stringify(p.listdisplaydata)]);
    snapshot.fields.forEach((f, i) => { if (f.datatype === "date") row.getCell(i + 1).numFmt = "yyyy-mm-dd"; else if (["string", "shorttext"].includes(f.datatype)) row.getCell(i + 1).numFmt = "@"; });
  });
  data.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, data.rowCount), column: headers.length } };
  data.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  data.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  data.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF79583D" } };
  const guide = workbook.addWorksheet("작성 안내"); guide.getColumn(1).width = 32; guide.getColumn(2).width = 95;
  guide.addRows([
    ["내보내기 범위", template ? "작성 양식" : `현재 필터의 전체 ${snapshot.total}건 · 목록 숨김 항목을 포함한 전체 값`],
    ["제한", "XLSX 5MB, 데이터 500행, 필드 40개, 변환 후 저장 요청 512KiB. 수식·매크로·외부 참조·병합 셀 불가."],
    ["새로 추가", "기도부탁 ID를 비웁니다. 기존 자료를 내려받은 파일은 기본적으로 기존 자료 수정 모드를 사용하세요."],
    ["기존 자료 수정", "숨겨진 ID와 수정 버전 열을 유지하세요. 매핑하지 않은 필드는 유지하고 매핑한 빈 셀은 값을 지웁니다. 파일에 없는 행은 삭제하지 않습니다."],
    ["선택·체크 항목", "등록된 선택지만 사용합니다. 여러 항목은 쉼표로 구분합니다."],
    ["날짜·예/아니오", "날짜는 YYYY-MM-DD 또는 날짜 셀. 예/아니오는 TRUE/FALSE 또는 예/아니오."],
    ["텍스트", "앞자리 0을 유지하려면 셀 형식을 텍스트로 사용하세요. 짧은 텍스트에는 줄바꿈을 넣지 않습니다."],
    ["첨부파일", "엑셀로 추가·교체·해제할 수 없습니다. 새 자료는 비우고 기존 링크는 유지하거나 해당 열을 매핑하지 마세요."],
    ["집계", "숫자의 합계가 아닌 값별 기도부탁 건수입니다. 다중 선택값 건수의 합은 전체 행 수보다 클 수 있습니다."],
  ]);
  snapshot.fields.forEach((f) => guide.addRow([f.name, `${TYPE_LABELS[f.datatype]}${f.option.length ? ` · ${f.option.join(", ")}` : ""}`]));
  guide.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });
  if (!template) {
    const summary = workbook.addWorksheet("집계"); summary.columns = [{ header: "범위", width: 28 }, { header: "필드", width: 24 }, { header: "값", width: 36 }, { header: "건수", width: 12 }, { header: "안내", width: 52 }];
    summary.addRow(["현재 필터 전체", "전체 기도부탁", "", snapshot.total]);
    const add = (scope: string, summaries: Summary[]) => summaries.forEach((s) => s.values.forEach((v) => summary.addRow([scope, snapshot.fields.find((f) => f.id === s.fieldId)?.name, v.label, v.count, s.pages > 1 ? `전체 ${s.valueCount}개 값 중 첫 ${s.values.length}개. 나머지는 화면 집계 페이지에서 확인.` : "전체 값"] )));
    add("현재 필터 전체", snapshot.summaries);
    snapshot.groups.forEach((g) => { summary.addRow([g.label, "그룹 전체", "", g.count]); add(g.label, g.summaries); });
  }
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  try { guardXlsx(bytes); } catch { throw new AppError(413, "엑셀 파일이 허용 크기를 넘습니다. 필터로 범위를 줄이거나 그룹화를 해제해주세요."); }
  return bytes;
}
