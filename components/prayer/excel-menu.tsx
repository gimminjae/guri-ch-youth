"use client";
import { useState } from "react";
import { canManage, fieldRevision, type Filter, type Role } from "@/lib/domain";
import type { ExcelInspection, ExcelMode, ExcelPreview } from "@/lib/excel-types";
import { api, messageOf } from "@/lib/api-client";
import { Alert, Button, FormField, Input, Modal, Pagination, Select } from "@/components/ui/ui";
import { Icon } from "@/components/ui/icon";
import { FieldValue } from "./prayer-list";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";
const system = [{ id: "__id", name: "기도부탁 ID" }, { id: "__version", name: "수정 버전" }, { id: "__display", name: "목록 표시 필드" }];
export function ExcelMenu({ role, filters, groupBy, onClose, onImported }: { role: Role | null; filters: Filter[]; groupBy: string; onClose: () => void; onImported: (count: number) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null), [inspection, setInspection] = useState<ExcelInspection | null>(null), [mapping, setMapping] = useState<string[]>([]);
  const [mode, setMode] = useState<ExcelMode>("add"), [preview, setPreview] = useState<ExcelPreview | null>(null), [page, setPage] = useState(1);
  const download = async (template: boolean) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/excel/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters, groupBy: groupBy || undefined, template }), credentials: "same-origin" });
      if (!response.ok) throw new Error((await response.json()).error || "다운로드하지 못했습니다.");
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = template ? "기도부탁-작성양식.xlsx" : "기도부탁.xlsx"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  return <Modal icon="sheet" title="엑셀" onClose={onClose} busy={busy}><div className={ui.stack}>

    <div className={ui.row}><Button icon="download" disabled={busy} onClick={() => download(false)}>현재 결과 다운로드</Button><Button variant="secondary" icon="sheet" disabled={busy} onClick={() => download(true)}>작성 양식 다운로드</Button></div>
    {canManage(role) && <>
      <hr className={styles.divider} /><h3 className={styles.smallTitle}><Icon name="upload" tone="sage" />엑셀 업로드</h3>
      <FormField label="엑셀 파일" htmlFor="excel-file"><Input id="excel-file" type="file" accept=".xlsx" disabled={busy} onChange={async (e) => {
        const selected = e.target.files?.[0]; setFile(null); setInspection(null); setPreview(null); setError(""); setPage(1); if (!selected) return;
        setBusy(true);
        try { const form = new FormData(); form.set("file", selected); const result = await api<ExcelInspection>("excel/inspect", "POST", form); setFile(selected); setInspection(result); setMapping(result.columns.map((c) => c.suggested)); }
        catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
      }} /></FormField>
      {inspection && <>
        <FormField label="저장 방식" htmlFor="excel-mode"><Select id="excel-mode" value={mode} disabled={busy} onChange={(e) => { setMode(e.target.value as ExcelMode); setPreview(null); }}><option value="add">새로 추가</option><option value="update">기존 자료 수정</option></Select></FormField>
        <Alert notice>{mode === "add" ? "신규 추가 · 기도부탁 ID는 빈 셀" : "미연결 필드·첨부파일 유지 · 연결한 빈 셀의 기존 값 삭제"}</Alert>
        <p className={ui.hint}>데이터 {inspection.rowCount}행</p>
        <div className={styles.mappingList}>{inspection.columns.map((column, i) => <FormField key={i} label={column.header} htmlFor={`mapping-${i}`} hint={`예: ${inspection.samples.map((r) => String(r[i] ?? "(빈 셀)")).join(" / ").slice(0, 120)}`}><Select id={`mapping-${i}`} disabled={busy} value={mapping[i]} onChange={(e) => { setMapping(mapping.map((v, index) => index === i ? e.target.value : v)); setPreview(null); }}><option value="">연결하지 않음</option>{inspection.fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}{system.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</Select></FormField>)}</div>
        <Button variant="secondary" icon="eye" busy={busy} disabled={!file} onClick={async () => { setBusy(true); setError(""); setPreview(null); setPage(1); try { const form = new FormData(); form.set("file", file!); form.set("settings", JSON.stringify({ mode, mapping, fieldRevision: fieldRevision(inspection.fields) })); setPreview(await api<ExcelPreview>("excel/preview", "POST", form)); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>검증하고 미리보기</Button>
        {preview && <section className={ui.stack} aria-label="엑셀 미리보기"><h3 className={styles.smallTitle}>{preview.count}행 · {mode === "add" ? "추가" : "수정"} 예정 · 오류 {preview.errors.length}개</h3>
          {preview.errors.length > 0 ? <><Alert>오류를 수정하고 파일을 다시 선택해주세요. 아직 저장한 자료는 없습니다.</Alert><ul className={styles.importErrors}>{preview.errors.slice((page - 1) * 10, page * 10).map((error, i) => <li key={i}>{error.row}행: {error.message}</li>)}</ul></> : <>

            {preview.rows.slice((page - 1) * 10, page * 10).map((row) => <div key={row.row} className={styles.importRow}><strong>{row.row}행</strong><dl className={styles.detailValues}>{inspection.fields.filter((f) => Object.hasOwn(row.content, f.id) || row.cleared.includes(f.id)).map((field) => <div key={field.id}><dt>{field.name}</dt><dd>{row.cleared.includes(field.id) ? <strong>값 삭제</strong> : <FieldValue field={field} value={row.content[field.id]} />}</dd></div>)}</dl></div>)}
          </>}
          <Pagination page={page} pages={Math.ceil((preview.errors.length || preview.rows.length) / 10)} onChange={setPage} />
          {preview.jobId && !preview.errors.length && <Button icon="save" busy={busy} onClick={async () => { setBusy(true); setError(""); try { const result = await api<{ count: number }>("excel/commit", "POST", { jobId: preview.jobId }); onImported(result.count); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>{preview.count}건 {mode === "add" ? "추가" : "수정"} 확정</Button>}
        </section>}
      </>}
    </>}
    {error && <Alert>{error}</Alert>}
  </div></Modal>;
}
