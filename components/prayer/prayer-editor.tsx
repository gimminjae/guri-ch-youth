"use client";
import { useState } from "react";
import { type Content, type Field, type Prayer, fieldRevision } from "@/lib/domain";
import { api, messageOf } from "@/lib/api-client";
import { Alert, Button, Modal } from "@/components/ui/ui";
import { DynamicField } from "./dynamic-field";
import ui from "@/components/ui/ui.module.css";

export function PrayerEditor({ fields, prayer, onClose, onSaved }: { fields: Field[]; prayer?: Prayer; onClose: () => void; onSaved: (prayer: Prayer) => void }) {
  const [content, setContent] = useState<Content>(prayer?.content ?? {});
  const [display, setDisplay] = useState(prayer?.listdisplaydata ?? fields.filter((f) => f.datatype !== "file" && f.datatype !== "image").slice(0, 3).map((f) => f.id));
  const [busy, setBusy] = useState(false), [uploads, setUploads] = useState(0), [error, setError] = useState("");
  const pending = busy || uploads > 0;
  return <Modal title={prayer ? "기도부탁 수정" : "기도부탁 나누기"} onClose={onClose} busy={pending}>
    <form onSubmit={async (event) => {
      event.preventDefault(); setError(""); setBusy(true);
      try {
        const saved = await api<Prayer>(prayer ? `prayers/${prayer.id}` : "prayers", prayer ? "PUT" : "POST", { content, listdisplaydata: display, fieldRevision: fieldRevision(fields), updateDateTime: prayer?.updateDateTime });
        onSaved(saved);
      } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
    }}>
      <div className={ui.stack}><p className={ui.hint}>작은 기도도 괜찮아요. 나눈 내용은 인증한 교회 구성원들이 함께 읽을 수 있어요.</p>
        {fields.map((field) => <DynamicField key={field.id} field={field} value={content[field.id]} disabled={busy} onUploading={(uploading) => setUploads((n) => n + (uploading ? 1 : -1))} onChange={(value) => setContent((current) => { const next = { ...current }; if (value === undefined) delete next[field.id]; else next[field.id] = value; return next; })} />)}
        <fieldset className={ui.field}><legend className={ui.label}>목록에 표시할 항목</legend><p className={ui.hint}>선택한 순서대로 표시해요. 다른 항목도 상세 화면에서 볼 수 있어요.</p><div className={ui.checkGroup}>{fields.map((field) => <label key={field.id} className={ui.check}><input type="checkbox" disabled={busy} checked={display.includes(field.id)} onChange={(e) => setDisplay((old) => e.target.checked ? [...old, field.id] : old.filter((id) => id !== field.id))} />{field.name}{display.includes(field.id) && <span className={ui.hint}>({display.indexOf(field.id) + 1})</span>}</label>)}</div></fieldset>
        {error && <Alert>{error}</Alert>}
      </div>
      <div className={ui.actions}><Button variant="secondary" onClick={onClose} disabled={pending}>취소</Button><Button type="submit" busy={pending} disabled={!fields.length}>{uploads ? "파일 업로드 중" : prayer ? "수정 저장" : "기도부탁 올리기"}</Button></div>
    </form>
  </Modal>;
}
