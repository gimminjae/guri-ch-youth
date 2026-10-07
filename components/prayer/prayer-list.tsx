"use client";
import Image from "next/image";
import { useState } from "react";
import { type Field, type Filter, type Group, type ListResult, type Prayer, type Value, valueText, isFile } from "@/lib/domain";
import { useApiResource } from "@/lib/use-api-resource";
import { Alert, Button, EmptyState, Pagination, cx } from "@/components/ui/ui";
import ui from "@/components/ui/ui.module.css";
import styles from "./prayer.module.css";

export function formatDate(value: string) { return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(value)); }
export function formatDateTime(value: string) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)); }
export function FieldValue({ field, value, full = false }: { field: Field; value?: Value; full?: boolean }) {
  if (value !== undefined && value !== "" && isFile(field.datatype)) return field.datatype === "image" && full
    ? <a href={`/api/files/${value}`} target="_blank" rel="noreferrer"><Image unoptimized src={`/api/files/${value}`} width={900} height={600} alt={`${field.name} 첨부 이미지`} className={styles.image} /></a>
    : <span className={styles.fileLabel}>{full ? <a href={`/api/files/${value}`} target="_blank" rel="noreferrer">첨부파일 열기 ↗</a> : "첨부파일 있음"}</span>;
  return <span className={cx(styles.value, field.displaytype.includes("badge") && styles.valueBadge, field.displaytype.includes("bold") && styles.bold, field.displaytype.includes("color") && styles.colored, !full && styles.clamp)}>{valueText(field, value)}</span>;
}
export function PrayerCard({ prayer, fields, onOpen }: { prayer: Prayer; fields: Field[]; onOpen: (id: string) => void }) {
  const visible = prayer.listdisplaydata.map((id) => fields.find((f) => f.id === id)).filter((f): f is Field => Boolean(f));
  return <article className={styles.card}>
    <div className={styles.cardTop}><span className={styles.cardTag}><span aria-hidden="true">✧</span> 함께 기도해요</span><time dateTime={new Date(prayer.createDateTime).toISOString()}>{formatDate(prayer.createDateTime)}</time></div>
    {visible.length ? <dl className={styles.values}>{visible.map((f) => <div key={f.id}><dt>{f.name}</dt><dd><FieldValue field={f} value={prayer.content[f.id]} /></dd></div>)}</dl> : <p className={styles.cardFallback}>새로운 기도부탁을 나누었어요.</p>}
    <button type="button" className={styles.cardLink} onClick={() => onOpen(prayer.id)} aria-label={`${formatDate(prayer.createDateTime)} 기도부탁 자세히 보기`}>기도부탁 자세히 보기 <span aria-hidden="true">↗</span></button>
  </article>;
}
export function GroupSection({ group, groupBy, filters, fields, onOpen, refresh }: { group: Group; groupBy: string; filters: Filter[]; fields: Field[]; onOpen: (id: string) => void; refresh: number }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const { data, error, loading } = useApiResource<ListResult>("prayers/query", { groupBy, groupKey: group.key, filters, page }, open, refresh + retry);
  return <section className={styles.group}>
    <button className={styles.groupHeader} onClick={() => setOpen(!open)} aria-expanded={open}><span>{group.label} <small>{group.count}</small></span><span aria-hidden="true">{open ? "−" : "+"}</span></button>
    {open && <div className={styles.groupBody}>{error ? <div className={ui.stack}><Alert>{error}</Alert><Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>다시 불러오기</Button></div> : loading ? <p role="status" className={ui.hint}>기도부탁을 불러오고 있어요…</p> : <>
      <div className={styles.cards}>{data?.items.map((prayer) => <PrayerCard key={prayer.id} prayer={prayer} fields={fields} onOpen={onOpen} />)}</div>
      {data && !data.items.length && <EmptyState title="이 그룹에 기도부탁이 없어요" description="조회 조건이 바뀌었을 수 있어요." />}
      {data && <Pagination page={page} pages={data.pages} onChange={setPage} />}
    </>}</div>}
  </section>;
}
