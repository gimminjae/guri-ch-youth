"use client";
import Image from "next/image";
import { useRef, useState, type MouseEvent, type KeyboardEvent } from "react";
import { type Field, type Filter, type Group, type ListResult, type Prayer, type Value, valueText, isFile, isMulti, fromCsv } from "@/lib/domain";
import { listDisplayFields } from "@/lib/list-display";
import { Icon } from "@/components/ui/icon";
import { optionStyle } from "@/lib/colors";
import { Summaries } from "./summaries";
import { useApiResource } from "@/lib/use-api-resource";
import { Alert, Button, EmptyState, Pagination, cx } from "@/components/ui/ui";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";

export function formatDate(value: string) { return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(value)); }
export function formatDateTime(value: string) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)); }
export function FieldValue({ field, value, full = false }: { field: Field; value?: Value; full?: boolean }) {
  if (value !== undefined && value !== "" && isFile(field.datatype)) {
    if (field.datatype === "image") return full
      ? <a href={`/api/files/${value}`} target="_blank" rel="noreferrer"><Image unoptimized src={`/api/files/${value}`} width={900} height={600} alt={`${field.name} 첨부 이미지`} className={styles.image} /></a>
      : <span className={styles.thumbnail}><Image unoptimized fill src={`/api/files/${value}`} alt={`${field.name} 첨부 이미지`} /></span>;
    return <span className={styles.fileLabel}>{full ? <a href={`/api/files/${value}`} target="_blank" rel="noreferrer"><Icon name="file" size={16} /> 첨부파일 <Icon name="link" size={14} /></a> : <><Icon name="file" size={16} /> 첨부</>}</span>;
  }
  const values = isMulti(field.datatype) && typeof value === "string" && value.trim() !== "" ? fromCsv(value) : [value];
  return <span className={styles.valueParts}>{values.map((part, index) => <span key={index} style={optionStyle(field.optionColors?.[String(part)], field.displaytype.includes("badge")) && (field.displaytype.includes("badge") || field.displaytype.includes("color")) ? optionStyle(field.optionColors?.[String(part)], field.displaytype.includes("badge")) : undefined} className={cx(styles.value, field.displaytype.includes("badge") && styles.valueBadge, field.displaytype.includes("bold") && styles.bold, field.displaytype.includes("color") && styles.colored, !full && styles.clamp)}>{valueText(field, part)}</span>)}</span>;
}
export function PrayerGrid({ prayers, fields, onOpen }: { prayers: Prayer[]; fields: Field[]; onOpen: (id: string) => void }) {
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const selectedFields = listDisplayFields(fields, prayers);
  const openRow = (event: MouseEvent, id: string) => {
    if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea")) return;
    if (event.detail !== 0 && pointer.current?.moved) return;
    if (window.getSelection()?.toString()) return;
    onOpen(id);
  };
  const rowKey = (event: KeyboardEvent, id: string) => {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(id); }
  };
  const value = (prayer: Prayer, field: Field) => prayer.listdisplaydata.includes(field.id)
    ? <FieldValue field={field} value={prayer.content[field.id]} />
    : <span className={styles.muted} aria-label="목록에서 숨긴 항목">—</span>;
  const detail = (prayer: Prayer) => <Button small variant="ghost" icon="chevronRight" aria-haspopup="dialog" onClick={() => onOpen(prayer.id)} aria-label={`${formatDate(prayer.createDateTime)} 기도부탁 자세히 보기`} />;
  return <div className={styles.grid}
    onPointerDown={(e) => { pointer.current = { x: e.clientX, y: e.clientY, moved: false }; }}
    onPointerMove={(e) => { const start = pointer.current; if (start && (Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8)) start.moved = true; }}
    onPointerCancel={() => { if (pointer.current) pointer.current.moved = true; }}>
    <div className={styles.tableScroll}>
      <table className={styles.prayerTable}>
        <caption className={ui.srOnly}>기도부탁 목록</caption>
        <colgroup>{selectedFields.map((field) => <col key={field.id} />)}{!selectedFields.length && <col />}<col className={styles.detailColumn} /></colgroup>
        <thead><tr>{selectedFields.map((field) => <th key={field.id} scope="col"><span className={styles.columnTitle} title={field.name}>{field.name}</span></th>)}{!selectedFields.length && <th scope="col">작성일</th>}<th scope="col"><span className={ui.srOnly}>상세</span><Icon name="eye" size={16} /></th></tr></thead>
        <tbody>{prayers.map((prayer) => <tr key={prayer.id} className={styles.prayerRow} tabIndex={0} aria-label={`${formatDate(prayer.createDateTime)} 기도부탁 상세 보기`} onClick={(e) => openRow(e, prayer.id)} onKeyDown={(e) => rowKey(e, prayer.id)}>
          {selectedFields.map((field) => <td key={field.id}><div className={styles.cellContent} title={prayer.listdisplaydata.includes(field.id) ? valueText(field, prayer.content[field.id]) : "목록에서 숨긴 항목"}>{value(prayer, field)}</div></td>)}
          {!selectedFields.length && <td><time dateTime={prayer.createDateTime}>{formatDate(prayer.createDateTime)}</time></td>}
          <td className={styles.detailCell}>{detail(prayer)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
export function GroupSection({ group, groupBy, filters, fields, onOpen, refresh, onFilter }: { group: Group; groupBy: string; filters: Filter[]; fields: Field[]; onOpen: (id: string) => void; refresh: number; onFilter: (filter: Filter) => void }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const { data, error, loading } = useApiResource<ListResult>("prayers/query", { groupBy, groupKey: group.key, filters, page }, open, refresh + retry);
  return <section className={styles.group}>
    <button className={styles.groupHeader} onClick={() => setOpen(!open)} aria-expanded={open}><span style={optionStyle(fields.find((f) => f.id === groupBy)?.optionColors?.[group.key ?? ""], false)}>{group.label} <small>{group.count}건</small></span><Icon name={open ? "chevronUp" : "chevronDown"} tone="amber" /></button>
    <Summaries compact summaries={group.summaries ?? []} fields={fields} query={{ filters, groupBy, groupKey: group.key, page: 1 }} refresh={refresh} onFilter={onFilter} />
    {open && <div className={styles.groupBody}>{error ? <div className={ui.stack}><Alert>{error}</Alert><Button variant="secondary" icon="refresh" onClick={() => setRetry((n) => n + 1)}>다시 불러오기</Button></div> : loading ? <p role="status" className={ui.hint}>기도부탁을 불러오고 있어요…</p> : <>
      <PrayerGrid prayers={data?.items ?? []} fields={fields} onOpen={onOpen} />
      {data && !data.items.length && <EmptyState title="기도부탁 없음" />}
      {data && <Pagination page={page} pages={data.pages} onChange={setPage} />}
    </>}</div>}
  </section>;
}
