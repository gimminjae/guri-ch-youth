"use client";
import { useState } from "react";
import { type Field, type Value, fromCsv, toCsv, isFile, isMulti } from "@/lib/domain";
import { api, messageOf } from "@/lib/api-client";
import { Alert, Button, FormField, Input, Select, TextArea } from "@/components/ui/ui";
import ui from "@/components/ui/ui.module.css";

export function DynamicField({ field, value, onChange, onUploading, disabled }: { field: Field; value?: Value; onChange: (value: Value | undefined) => void; onUploading?: (busy: boolean) => void; disabled?: boolean }) {
  const [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const id = `field-${field.id}`;
  const shared = { id, disabled, "aria-label": field.name };
  if (isFile(field.datatype)) return <FormField label={field.name} htmlFor={id} hint={field.datatype === "image" ? "JPG, PNG, WebP, GIF · 최대 4MB" : "이미지, PDF, DOCX, XLSX, PPTX · 최대 4MB"}>
    {value && <div className={ui.row}><a href={`/api/files/${value}`} target="_blank" rel="noreferrer">첨부파일 확인 ↗</a><Button small variant="ghost" disabled={disabled || uploading} onClick={() => onChange(undefined)}>첨부 해제</Button></div>}
    <Input {...shared} type="file" disabled={disabled || uploading} accept={field.datatype === "image" ? ".jpg,.jpeg,.png,.webp,.gif" : ".jpg,.jpeg,.png,.webp,.gif,.pdf,.docx,.xlsx,.pptx"} onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      setError(""); setUploading(true); onUploading?.(true);
      try {
        const form = new FormData(); form.set("file", file); form.set("fieldId", field.id);
        const result = await api<{ id: string }>("uploads", "POST", form); onChange(result.id);
      } catch (e) { setError(messageOf(e)); } finally { setUploading(false); onUploading?.(false); }
    }} />
    {uploading && <p role="status" className={ui.hint}>첨부파일을 올리고 있어요…</p>}{error && <Alert>{error}</Alert>}
  </FormField>;
  if (isMulti(field.datatype)) {
    const selected = fromCsv(String(value ?? ""));
    return <fieldset className={ui.field}><legend className={ui.label}>{field.name}</legend><div className={ui.checkGroup}>{field.option.map((option) => <label className={ui.check} key={option}><input type="checkbox" disabled={disabled} checked={selected.includes(option)} onChange={(e) => onChange(toCsv(e.target.checked ? [...selected, option] : selected.filter((v) => v !== option)))} />{option}</label>)}</div></fieldset>;
  }
  return <FormField label={field.name} htmlFor={id}>
    {field.datatype === "string" && <TextArea {...shared} value={String(value ?? "")} maxLength={10000} onChange={(e) => onChange(e.target.value)} placeholder="함께 기도할 내용을 적어주세요." />}
    {field.datatype === "number" && <Input {...shared} type="number" step="any" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)} />}
    {field.datatype === "date" && <Input {...shared} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)} />}
    {field.datatype === "selectbox" && <Select {...shared} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)}><option value="">선택해주세요</option>{field.option.map((v) => <option key={v} value={v}>{v}</option>)}</Select>}
    {field.datatype === "bool" && <Select {...shared} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}><option value="">선택해주세요</option><option value="true">예</option><option value="false">아니오</option></Select>}
  </FormField>;
}
