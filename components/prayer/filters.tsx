"use client";
import { useState } from "react";
import { type Field, type Filter, isChoice, isFile } from "@/lib/domain";
import { Icon } from "@/components/ui/icon";
import { Button, Input, Select } from "@/components/ui/ui";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";

export function Filters({ fields, active, groupBy, onGroup, onApply, onReset }: { fields: Field[]; active: Filter[]; groupBy: string; onGroup: (id: string) => void; onApply: (filters: Filter[]) => void; onReset: () => void }) {
  const filterFields = fields.filter((f) => f.isFilterable), groupFields = fields.filter((f) => f.isGroupable);
  const [draft, setDraft] = useState<Record<string, Filter>>(Object.fromEntries(active.map((f) => [f.fieldId, f])));
  const [expanded, setExpanded] = useState(false);
  const change = (id: string, filter?: Filter) => setDraft((old) => { const next = { ...old }; if (filter) next[id] = filter; else delete next[id]; return next; });
  return <section className={styles.filterBar} aria-label="기도부탁 조회 조건">
    <div className={styles.viewBar}><nav className={styles.viewTabs} aria-label="그룹 보기"><button aria-pressed={!groupBy} onClick={() => onGroup("")}><Icon name="list" size={16} />전체보기</button>{groupFields.map((f) => <button key={f.id} aria-pressed={groupBy === f.id} onClick={() => onGroup(f.id)}><Icon name="group" size={16} />{f.name}별</button>)}</nav><Button variant="secondary" small aria-expanded={expanded} aria-controls="prayer-filter-options" onClick={() => setExpanded(!expanded)}><Icon name="filter" tone="blue" />필터{active.length ? ` · ${active.length}` : ""}<Icon name={expanded ? "chevronUp" : "chevronDown"} size={14} /></Button></div>
    <div id="prayer-filter-options" className={styles.filterPanel} hidden={!expanded}>
      <form className={styles.filterForm} onSubmit={(e) => { e.preventDefault(); onApply(Object.values(draft)); }}>
        <div className={ui.between}><h3 className={styles.smallTitle}><Icon name="filter" tone="blue" />필터</h3><Button variant="ghost" icon="refresh" small onClick={() => { setDraft({}); onReset(); }}>초기화</Button></div>
        {!filterFields.length && <p className={ui.hint}>필터 항목 없음</p>}
        {filterFields.map((field) => {
          const current = draft[field.id];
          const empty = current?.op === "empty";
          return <fieldset key={field.id} className={ui.field}><legend className={ui.label}>{field.name}</legend>
            {!isFile(field.datatype) && <label className={ui.check}><input type="checkbox" checked={empty} onChange={(e) => change(field.id, e.target.checked ? { fieldId: field.id, op: "empty" } : undefined)} />미입력만 보기</label>}
            {isChoice(field.datatype) && <div className={ui.checkGroup}>{field.option.map((v) => {
              const selected = Array.isArray(current?.value) ? current.value : [];
              return <label key={v} className={ui.check}><input disabled={empty} type="checkbox" checked={selected.includes(v)} onChange={(e) => { const values = e.target.checked ? [...selected, v] : selected.filter((s) => s !== v); change(field.id, values.length ? { fieldId: field.id, op: "in", value: values } : undefined); }} />{v}</label>;
            })}</div>}
            {["string", "shorttext"].includes(field.datatype) && <Input aria-label={`${field.name} 검색`} disabled={empty} placeholder="포함된 단어" value={typeof current?.value === "string" ? current.value : ""} onChange={(e) => change(field.id, e.target.value.trim() ? { fieldId: field.id, op: "contains", value: e.target.value } : undefined)} />}
            {(field.datatype === "date" || field.datatype === "number") && <div className={styles.range}>{(["min", "max"] as const).map((bound) => <Input key={bound} aria-label={`${field.name} ${bound === "min" ? "시작" : "끝"}`} type={field.datatype === "date" ? "date" : "number"} step="any" disabled={empty} placeholder={bound === "min" ? "최솟값" : "최댓값"} value={current?.[bound] ?? ""} onChange={(e) => { const filter: Filter = { ...current, fieldId: field.id, op: "range" }; if (e.target.value === "") delete filter[bound]; else filter[bound] = field.datatype === "number" ? e.target.valueAsNumber : e.target.value; change(field.id, filter.min === undefined && filter.max === undefined ? undefined : filter); }} />)}</div>}
            {field.datatype === "bool" && <Select aria-label={`${field.name} 조건`} disabled={empty} value={typeof current?.value === "boolean" ? String(current.value) : ""} onChange={(e) => change(field.id, e.target.value === "" ? undefined : { fieldId: field.id, op: "eq", value: e.target.value === "true" })}><option value="">전체</option><option value="true">예</option><option value="false">아니오</option></Select>}
            {isFile(field.datatype) && <Select aria-label={`${field.name} 첨부 여부`} value={current?.op ?? ""} onChange={(e) => change(field.id, e.target.value ? { fieldId: field.id, op: e.target.value as "empty" | "present" } : undefined)}><option value="">전체</option><option value="present">첨부 있음</option><option value="empty">첨부 없음</option></Select>}
          </fieldset>;
        })}
        {!!filterFields.length && <Button variant="secondary" icon="check" type="submit">필터 적용{active.length ? ` · ${active.length}` : ""}</Button>}
      </form>
    </div>
  </section>;
}
