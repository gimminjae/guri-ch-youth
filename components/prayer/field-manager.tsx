"use client";
import { useEffect, useState } from "react";
import { DATA_TYPES, DISPLAY_TYPES, TYPE_LABELS, fieldRevision, type Field, type FieldInput, isChoice } from "@/lib/domain";
import { api, messageOf } from "@/lib/api-client";
import { Alert, Badge, Button, FormField, Input, Modal } from "@/components/ui/ui";
import { Icon, type IconName } from "@/components/ui/icon";
import { ColorPicker } from "@/components/ui/color-picker";
import { DynamicField } from "./dynamic-field";
import { FieldValue } from "./prayer-list";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";

const newField: FieldInput = { name: "", datatype: "shorttext", displaytype: [], option: [], optionColors: {}, isAggregatable: false, isGroupable: false, isFilterable: false };
const typeIcons: Record<Field["datatype"], IconName> = { selectbox: "chevronDown", selectmultibox: "list", checkbox: "check", shorttext: "edit", string: "text", number: "number", date: "calendar", image: "image", file: "file", bool: "check" };
const move = <T,>(items: T[], index: number, offset: number) => { const next = [...items]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; };
export function FieldManager({ fields: initialFields, onClose, onChanged }: { fields: Field[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [fields, setFields] = useState(initialFields), [ready, setReady] = useState(false), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Field | "new" | null>(null), [order, setOrder] = useState<string[]>([]);
  const [error, setError] = useState(""), [deleting, setDeleting] = useState<Field | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    api<{ fields: Field[] }>("fields/manage").then((result) => { if (current) { setFields(result.fields); setReady(true); setError(""); } }).catch((e) => { if (current) setError(messageOf(e)); });
    return () => { current = false; };
  }, [retry]);
  const refresh = async () => { const result = await api<{ fields: Field[] }>("fields/manage"); setFields(result.fields); await onChanged(); };
  const ordered = [...order.filter((id) => fields.some((f) => f.id === id)), ...fields.filter((f) => !order.includes(f.id)).map((f) => f.id)].map((id) => fields.find((f) => f.id === id)!);
  const changed = ordered.some((f, i) => f.id !== fields[i]?.id);
  if (editing) return <FieldEditor field={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={async () => { await refresh(); setEditing(null); }} />;
  if (deleting) return <Modal icon="trash" title="미사용 필드 삭제" onClose={() => setDeleting(null)} busy={busy}><div className={ui.stack}><strong>{deleting.name}</strong><p className={ui.hint}>필드·모든 기도부탁의 해당 값·첨부파일 영구 삭제 · 복구 불가</p></div>{error && <Alert>{error}</Alert>}<div className={ui.actions}><Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>취소</Button><Button variant="danger" icon="trash" busy={busy} onClick={async () => { setBusy(true); setError(""); try { await api(`fields/${deleting.id}`, "DELETE", { updateDateTime: deleting.updateDateTime }); await refresh(); setDeleting(null); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>필드와 저장된 값 삭제</Button></div></Modal>;
  return <Modal icon="fields" title="기도부탁 필드 관리" onClose={onClose} busy={busy}><div className={ui.stack}>


    {error && <Alert>{error}</Alert>}
    {!ready && (error ? <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>다시 불러오기</Button> : <p role="status" className={ui.hint}>전체 필드를 불러오고 있어요…</p>)}
    {ready && ordered.map((field, index) => <div key={field.id} className={styles.fieldRow}><div><strong>{index + 1}. {field.name}</strong><div className={ui.row}><Badge accent={field.isActive}>{field.isActive ? "사용 중" : "미사용"}</Badge><Badge>{TYPE_LABELS[field.datatype]}</Badge>{field.isGroupable && <Badge accent>그룹화</Badge>}{field.isFilterable && <Badge accent>필터링</Badge>}{field.isAggregatable && <Badge accent>집계</Badge>}</div></div><div className={ui.row}>
      <Button small variant="ghost" disabled={busy || index === 0} aria-label={`${field.name} 위로`} onClick={() => setOrder(move(ordered.map((f) => f.id), index, -1))}><Icon name="arrowUp" /></Button><Button small variant="ghost" disabled={busy || index === ordered.length - 1} aria-label={`${field.name} 아래로`} onClick={() => setOrder(move(ordered.map((f) => f.id), index, 1))}><Icon name="arrowDown" /></Button>
      <Button variant="secondary" icon="edit" small disabled={busy || changed} onClick={() => setEditing(field)} aria-label={`${field.name} 필드 수정`}>수정</Button>
      <Button variant="secondary" icon={field.isActive ? "eyeOff" : "eye"} small disabled={busy || changed} aria-label={`${field.name} ${field.isActive ? "미사용으로 전환" : "다시 사용"}`} onClick={async () => { setBusy(true); setError(""); try { await api(`fields/${field.id}`, "PATCH", { isActive: !field.isActive, updateDateTime: field.updateDateTime }); await refresh(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>{field.isActive ? "미사용으로 전환" : "다시 사용"}</Button>
      <Button variant="ghost" icon="trash" small disabled={busy || changed || field.isActive} onClick={() => { setError(""); setDeleting(field); }} aria-label={`${field.name} 필드 삭제`} title={field.isActive ? "미사용으로 전환한 후 삭제할 수 있습니다." : undefined}>삭제</Button></div></div>)}
    {ready && changed && <Button icon="save" busy={busy} onClick={async () => { setBusy(true); setError(""); try { await api("fields/order", "PUT", { ids: ordered.map((f) => f.id), fieldRevision: fieldRevision(fields) }); await refresh(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>열 순서 저장</Button>}
    {ready && !fields.length && <p className={ui.hint}>등록된 필드 없음</p>}
    <Button variant="secondary" icon="plus" onClick={() => setEditing("new")} disabled={!ready || busy || changed || fields.length >= 40}>필드 추가</Button>
  </div></Modal>;
}
function FieldEditor({ field, onClose, onSaved }: { field?: Field; onClose: () => void; onSaved: () => Promise<void> }) {
  const [input, setInput] = useState<FieldInput>(field ?? newField);
  const [options, setOptions] = useState(() => (field?.option ?? []).map((name) => ({ name, color: field?.optionColors?.[name] })));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const preview: Field = { ...input, isActive: field?.isActive ?? true, listOrder: field?.listOrder ?? 0, option: options.map((o) => o.name.trim()).filter(Boolean), optionColors: Object.fromEntries(options.filter((o) => o.color).map((o) => [o.name.trim(), o.color!])), id: "preview", createDateTime: "", updateDateTime: "" };
  return <Modal icon="fields" title={field ? "필드 수정" : "새 필드 추가"} onClose={onClose} busy={busy}><form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try {
    if (isChoice(input.datatype) && (options.some((o) => !o.name.trim()) || new Set(preview.option).size !== options.length)) throw new Error("선택지는 비어 있거나 중복될 수 없습니다.");
    await api(field ? `fields/${field.id}` : "fields", field ? "PUT" : "POST", { ...input, option: isChoice(input.datatype) ? preview.option : [], optionColors: isChoice(input.datatype) ? preview.optionColors : {}, updateDateTime: field?.updateDateTime }); await onSaved();
  } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>
    <div className={ui.stack}>
      <FormField label="필드 이름" htmlFor="field-name"><Input id="field-name" value={input.name} required maxLength={100} disabled={busy} placeholder="예: 이름, 기도 내용" onChange={(e) => setInput({ ...input, name: e.target.value })} /></FormField>
      <fieldset className={ui.field} disabled={busy}><legend className={ui.label}>입력 형식</legend><div className={styles.typeChoices}>{DATA_TYPES.map((type) => <label key={type} className={styles.typeChoice}><input className={ui.srOnly} type="radio" name="field-type" value={type} checked={input.datatype === type} onChange={() => setInput({ ...input, datatype: type })} /><span><Icon name={typeIcons[type]} />{TYPE_LABELS[type]}</span></label>)}</div></fieldset>
      {isChoice(input.datatype) && <fieldset className={ui.field}><legend className={ui.label}>선택지와 색상</legend>
        {options.map((option, index) => <div key={index} className={styles.optionRow}><Input aria-label={`선택지 ${index + 1}`} value={option.name} maxLength={100} required disabled={busy} onChange={(e) => setOptions(options.map((o, i) => i === index ? { ...o, name: e.target.value } : o))} /><ColorPicker value={option.color} label={`선택지 ${index + 1}`} disabled={busy} onChange={(color) => setOptions(options.map((o, i) => i === index ? { ...o, color } : o))} /><div className={ui.row}><Button small variant="ghost" disabled={busy || index === 0} aria-label={`선택지 ${index + 1} 위로`} onClick={() => setOptions(move(options, index, -1))}><Icon name="arrowUp" /></Button><Button small variant="ghost" disabled={busy || index === options.length - 1} aria-label={`선택지 ${index + 1} 아래로`} onClick={() => setOptions(move(options, index, 1))}><Icon name="arrowDown" /></Button><Button small variant="ghost" disabled={busy} aria-label={`선택지 ${index + 1} 삭제`} onClick={() => setOptions(options.filter((_, i) => i !== index))}><Icon name="trash" />삭제</Button></div></div>)}
        <Button small variant="secondary" disabled={busy || options.length >= 60} onClick={() => setOptions([...options, { name: "", color: undefined }])}><Icon name="plus" />선택지 추가</Button></fieldset>}
      <fieldset className={ui.field}><legend className={ui.label}>표시 방식</legend><div className={ui.row}>{DISPLAY_TYPES.map((type) => <label key={type} className={ui.check}><input type="checkbox" disabled={busy} checked={input.displaytype.includes(type)} onChange={(e) => setInput({ ...input, displaytype: e.target.checked ? [...input.displaytype, type] : input.displaytype.filter((v) => v !== type) })} />{{ badge: "배지", bold: "굵게", color: "강조색" }[type]}</label>)}</div></fieldset>
      <div className={styles.settingsBox}>{(["isGroupable", "isFilterable", "isAggregatable"] as const).map((key) => <label key={key} className={ui.check}><input type="checkbox" checked={input[key]} disabled={busy} onChange={(e) => setInput({ ...input, [key]: e.target.checked })} />{{ isGroupable: "그룹화", isFilterable: "필터링", isAggregatable: "집계" }[key]}</label>)}</div>
      <div className={styles.preview}><span className={styles.eyebrow}>미리보기</span><DynamicField field={preview} disabled onChange={() => {}} />{isChoice(input.datatype) && <FieldValue field={preview} value={input.datatype === "selectbox" ? preview.option[0] : preview.option.join(",")} />}</div>
      {error && <Alert>{error}</Alert>}
    </div><div className={ui.actions}><Button variant="secondary" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" icon="save" busy={busy}>필드 저장</Button></div>
  </form></Modal>;
}
