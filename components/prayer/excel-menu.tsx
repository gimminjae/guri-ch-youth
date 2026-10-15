"use client";
import { useRef, useState } from "react";
import { canManage, fieldRevision, type Filter, type Role } from "@/lib/domain";
import type { ExcelInspection, ExcelMode, ExcelPreview } from "@/lib/excel-types";
import { api, messageOf } from "@/lib/api-client";
import { Alert, Button, FormField, Modal, Pagination, Select } from "@/components/ui/ui";
import { Icon } from "@/components/ui/icon";
import { FieldValue } from "./prayer-list";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";

const system = [{ id: "__id", name: "기도부탁 ID" }, { id: "__version", name: "수정 버전" }, { id: "__display", name: "목록 표시 필드" }];
type ExcelAction = "download" | "upload";
export function ExcelMenu({ role, filters, groupBy, initialAction = "download", onClose, onImported }: { role: Role | null; filters: Filter[]; groupBy: string; initialAction?: ExcelAction; onClose: () => void; onImported: (count: number) => void }) {
  const [action, setAction] = useState<ExcelAction>(initialAction);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null), [inspection, setInspection] = useState<ExcelInspection | null>(null), [mapping, setMapping] = useState<string[]>([]);
  const [mode, setMode] = useState<ExcelMode>("add"), [preview, setPreview] = useState<ExcelPreview | null>(null), [page, setPage] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = canManage(role) && action === "upload";
  const step = preview ? 2 : inspection ? 1 : 0;
  const download = async (template: boolean) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/excel/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters, groupBy: groupBy || undefined, template }), credentials: "same-origin" });
      if (!response.ok) throw new Error((await response.json()).error || "다운로드하지 못했습니다.");
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = template ? "기도부탁-작성양식.xlsx" : "기도부탁.xlsx"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  const inspect = async (selected: File) => {
    setFile(null); setInspection(null); setPreview(null); setMapping([]); setError(""); setPage(1); setBusy(true);
    try {
      if (!selected.name.toLowerCase().endsWith(".xlsx")) throw new Error(".xlsx 파일을 선택해주세요.");
      const form = new FormData(); form.set("file", selected);
      const result = await api<ExcelInspection>("excel/inspect", "POST", form);
      if (!result.rowCount) throw new Error("머리글 아래에 등록할 데이터를 입력해주세요.");
      setFile(selected); setInspection(result); setMapping(result.columns.map((c) => c.suggested));
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  const validate = async () => {
    if (!file || !inspection) return;
    setBusy(true); setError(""); setPreview(null); setPage(1);
    try {
      const form = new FormData(); form.set("file", file); form.set("settings", JSON.stringify({ mode, mapping, fieldRevision: fieldRevision(inspection.fields) }));
      setPreview(await api<ExcelPreview>("excel/preview", "POST", form));
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!preview?.jobId || preview.errors.length) return;
    setBusy(true); setError("");
    try { const result = await api<{ count: number }>("excel/commit", "POST", { jobId: preview.jobId }); onImported(result.count); }
    catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  return <Modal icon={uploading ? "upload" : "sheet"} title={uploading ? "엑셀 일괄 등록" : "엑셀 다운로드"} onClose={onClose} busy={busy}><div className={ui.stack}>
    {canManage(role) && <div className={styles.excelActions} role="group" aria-label="엑셀 작업">
      <Button variant={uploading ? "secondary" : "primary"} icon="download" aria-pressed={!uploading} disabled={busy} onClick={() => { setAction("download"); setError(""); }}>다운로드</Button>
      <Button variant={uploading ? "primary" : "secondary"} icon="upload" aria-pressed={uploading} disabled={busy} onClick={() => { setAction("upload"); setError(""); }}>일괄 등록</Button>
    </div>}
    {error && <Alert>{error}</Alert>}
    {!uploading ? <div className={ui.row}><Button icon="download" disabled={busy} onClick={() => download(false)}>현재 결과 다운로드</Button><Button variant="secondary" icon="sheet" disabled={busy} onClick={() => download(true)}>작성 양식 다운로드</Button></div> : <>
      <ol className={styles.importSteps} aria-label="엑셀 등록 단계">{["파일 선택", "열 연결", "미리보기"].map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Icon name="check" size={14} /> : index + 1}</span>{label}</li>)}</ol>
      <div className={ui.between}><Button variant="secondary" icon="sheet" disabled={busy} onClick={() => download(true)}>작성 양식 다운로드</Button><span className={ui.hint}>.xlsx · 최대 5MB · 500행</span></div>
      <div className={styles.importFile}>
        <input ref={fileInput} className={ui.srOnly} aria-label="엑셀 파일" type="file" accept=".xlsx" disabled={busy} onChange={(e) => { const selected = e.target.files?.[0]; e.target.value = ""; if (selected) void inspect(selected); }} />
        <Icon name="sheet" tone="sage" size={24} /><div><strong>{file?.name ?? "엑셀 파일 선택"}</strong>{inspection && <span>{inspection.rowCount}행 · {inspection.columns.length}열</span>}</div>
        <Button variant="secondary" icon="upload" busy={busy} onClick={() => fileInput.current?.click()}>{file ? "파일 변경" : "파일 선택"}</Button>
      </div>
      {inspection && !preview && <>
        <FormField label="저장 방식" htmlFor="excel-mode"><Select id="excel-mode" value={mode} disabled={busy} onChange={(e) => { setMode(e.target.value as ExcelMode); setError(""); }}><option value="add">새 자료 일괄 등록</option><option value="update">기존 자료 일괄 수정</option></Select></FormField>
        {mode === "update" && <Alert notice>미연결 필드·첨부파일 유지 · 연결한 빈 셀의 기존 값 삭제</Alert>}
        <h3 className={styles.smallTitle}><Icon name="fields" tone="blue" />열과 필드 연결</h3>
        <div className={styles.mappingList}>{inspection.columns.map((column, i) => <FormField key={i} label={column.header} htmlFor={`mapping-${i}`} hint={`예: ${inspection.samples.map((r) => String(r[i] ?? "(빈 셀)")).join(" / ").slice(0, 120)}`}><Select id={`mapping-${i}`} disabled={busy} value={mapping[i]} onChange={(e) => { setMapping(mapping.map((v, index) => index === i ? e.target.value : v)); setError(""); }}><option value="">연결하지 않음</option>{inspection.fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}{system.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</Select></FormField>)}</div>
        <Button icon="eye" busy={busy} disabled={!mapping.some((id) => inspection.fields.some((field) => field.id === id))} onClick={validate}>검증하고 미리보기</Button>
      </>}
      {inspection && preview && <section className={ui.stack} aria-label="엑셀 미리보기">
        <div className={ui.between}><h3 className={styles.smallTitle}>{preview.count}건 · {mode === "add" ? "신규 등록" : "기존 자료 수정"} · 오류 {preview.errors.length}개</h3><Button variant="ghost" icon="chevronLeft" small disabled={busy} onClick={() => { setPreview(null); setError(""); setPage(1); }}>열 연결 수정</Button></div>
        {preview.errors.length > 0 ? <><Alert>오류를 수정하고 파일을 다시 선택해주세요. 아직 저장한 자료는 없습니다.</Alert><ul className={styles.importErrors}>{preview.errors.slice((page - 1) * 10, page * 10).map((error, i) => <li key={i}>{error.row}행: {error.message}</li>)}</ul></> : <>
          {preview.rows.slice((page - 1) * 10, page * 10).map((row) => <div key={row.row} className={styles.importRow}><strong>{row.row}행</strong><dl className={styles.detailValues}>{inspection.fields.filter((f) => Object.hasOwn(row.content, f.id) || row.cleared.includes(f.id)).map((field) => <div key={field.id}><dt>{field.name}</dt><dd>{row.cleared.includes(field.id) ? <strong>값 삭제</strong> : <FieldValue field={field} value={row.content[field.id]} full />}</dd></div>)}</dl></div>)}
        </>}
        <Pagination page={page} pages={Math.ceil((preview.errors.length || preview.rows.length) / 10)} onChange={setPage} />
        {preview.jobId && !preview.errors.length && <Button icon="save" busy={busy} onClick={commit}>{preview.count}건 일괄 {mode === "add" ? "등록" : "수정"}</Button>}
      </section>}
    </>}
  </div></Modal>;
}
