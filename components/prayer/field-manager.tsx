"use client";
import { useState } from "react";
import { DATA_TYPES, DISPLAY_TYPES, TYPE_LABELS, type Field, type FieldInput, isChoice } from "@/lib/domain";
import { api, messageOf } from "@/lib/api-client";
import { Alert, Badge, Button, FormField, Input, Modal, Select, TextArea } from "@/components/ui/ui";
import { DynamicField } from "./dynamic-field";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";

const newField: FieldInput = { name: "", datatype: "string", displaytype: [], option: [], isGroupable: false, isFilterable: false };
export function FieldManager({ fields, onClose, onChanged }: { fields: Field[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<Field | "new" | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Field | null>(null);
  const [busy, setBusy] = useState(false);
  if (editing) return <FieldEditor field={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={async () => { await onChanged(); setEditing(null); }} />;
  if (deleting) return <Modal title="필드를 삭제할까요?" onClose={() => setDeleting(null)} busy={busy}><p><strong>{deleting.name}</strong> 필드를 삭제합니다. 기도부탁에서 사용 중인 필드는 삭제할 수 없어요.</p>{error && <Alert>{error}</Alert>}<div className={ui.actions}><Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>취소</Button><Button variant="danger" busy={busy} onClick={async () => { setBusy(true); setError(""); try { await api(`fields/${deleting.id}`, "DELETE", { updateDateTime: deleting.updateDateTime }); await onChanged(); setDeleting(null); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>필드 삭제</Button></div></Modal>;
  return <Modal title="기도부탁 필드 관리" onClose={onClose}>
    <div className={ui.stack}><p className={ui.hint}>작성할 항목을 직접 구성하고 목록의 그룹화·필터링 기준을 설정하세요.</p>
      {fields.map((field) => <div key={field.id} className={styles.fieldRow}><div><strong>{field.name}</strong><div className={ui.row}><Badge>{TYPE_LABELS[field.datatype]}</Badge>{field.isGroupable && <Badge accent>그룹화</Badge>}{field.isFilterable && <Badge accent>필터링</Badge>}</div></div><div className={ui.row}><Button variant="secondary" small onClick={() => setEditing(field)} aria-label={`${field.name} 필드 수정`}>수정</Button><Button variant="ghost" small onClick={() => { setError(""); setDeleting(field); }} aria-label={`${field.name} 필드 삭제`}>삭제</Button></div></div>)}
      {!fields.length && <p className={ui.hint}>아직 필드가 없어요. 먼저 기도 내용을 입력할 필드를 추가해주세요.</p>}
      <Button onClick={() => setEditing("new")} disabled={fields.length >= 40}>＋ 필드 추가</Button>
    </div>
  </Modal>;
}
function FieldEditor({ field, onClose, onSaved }: { field?: Field; onClose: () => void; onSaved: () => Promise<void> }) {
  const [input, setInput] = useState<FieldInput>(field ?? newField), [options, setOptions] = useState(field?.option.join("\n") ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const preview = { ...input, option: options.split("\n").map((v) => v.trim()).filter(Boolean), id: "preview", createDateTime: "", updateDateTime: "" };
  return <Modal title={field ? "필드 수정" : "새 필드 추가"} onClose={onClose} busy={busy}>
    <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try { await api(field ? `fields/${field.id}` : "fields", field ? "PUT" : "POST", { ...input, option: isChoice(input.datatype) ? preview.option : [], updateDateTime: field?.updateDateTime }); await onSaved(); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); } }}>
      <div className={ui.stack}>
        <FormField label="필드 이름" htmlFor="field-name"><Input id="field-name" value={input.name} required maxLength={100} disabled={busy} placeholder="예: 기도 내용, 이름, 기도 분류" onChange={(e) => setInput({ ...input, name: e.target.value })} /></FormField>
        <FormField label="입력 형식" htmlFor="field-type"><Select id="field-type" value={input.datatype} disabled={busy} onChange={(e) => setInput({ ...input, datatype: e.target.value as Field["datatype"] })}>{DATA_TYPES.map((type) => <option value={type} key={type}>{TYPE_LABELS[type]}</option>)}</Select></FormField>
        {isChoice(input.datatype) && <FormField label="선택지" htmlFor="field-options" hint="한 줄에 하나씩 입력해주세요. 선택지 안에는 쉼표를 사용할 수 없어요."><TextArea id="field-options" value={options} disabled={busy} placeholder={"학업\n진로\n가정"} onChange={(e) => setOptions(e.target.value)} /></FormField>}
        <fieldset className={ui.field}><legend className={ui.label}>표시 방식</legend><div className={ui.row}>{DISPLAY_TYPES.map((type) => <label key={type} className={ui.check}><input type="checkbox" disabled={busy} checked={input.displaytype.includes(type)} onChange={(e) => setInput({ ...input, displaytype: e.target.checked ? [...input.displaytype, type] : input.displaytype.filter((v) => v !== type) })} />{{ badge: "배지", bold: "굵게", color: "강조색" }[type]}</label>)}</div></fieldset>
        <div className={styles.settingsBox}><label className={ui.check}><input type="checkbox" checked={input.isGroupable} disabled={busy} onChange={(e) => setInput({ ...input, isGroupable: e.target.checked })} />목록에서 이 필드로 그룹화 허용</label><label className={ui.check}><input type="checkbox" checked={input.isFilterable} disabled={busy} onChange={(e) => setInput({ ...input, isFilterable: e.target.checked })} />목록에서 이 필드로 필터링 허용</label></div>
        <div className={styles.preview}><span className={styles.eyebrow}>입력 화면 미리보기</span><DynamicField field={preview} disabled onChange={() => {}} /></div>
        {error && <Alert>{error}</Alert>}
      </div><div className={ui.actions}><Button variant="secondary" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" busy={busy}>필드 저장</Button></div>
    </form>
  </Modal>;
}
