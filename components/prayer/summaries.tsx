"use client";
import { useState } from "react";
import { type Field, type Filter, type ListQuery, type Summary, isChoice, isFile } from "@/lib/domain";
import { Icon } from "@/components/ui/icon";
import { optionStyle } from "@/lib/colors";
import { useApiResource } from "@/lib/use-api-resource";
import { Alert, Pagination } from "@/components/ui/ui";
import styles from "./prayer.module.css";

export function countFilter(field: Field, key: string | null): Filter {
  if (key === null) return { fieldId: field.id, op: "empty" };
  if (isFile(field.datatype)) return { fieldId: field.id, op: "present" };
  if (isChoice(field.datatype)) return { fieldId: field.id, op: "in", value: [key] };
  return { fieldId: field.id, op: "eq", value: field.datatype === "number" ? Number(key) : field.datatype === "bool" ? key === "true" : key };
}
export function Summaries({ summaries, fields, query, refresh, onFilter, compact = false }: { summaries: Summary[]; fields: Field[]; query: ListQuery; refresh: number; onFilter?: (filter: Filter) => void; compact?: boolean }) {
  return <div className={compact ? styles.compactSummaries : styles.summaries}>{summaries.map((summary) => {
    const field = fields.find((f) => f.id === summary.fieldId);
    return field && <SummaryField key={`${summary.fieldId}:${refresh}:${JSON.stringify(query)}`} initial={summary} field={field} query={query} refresh={refresh} onFilter={onFilter} />;
  })}</div>;
}
function SummaryField({ initial, field, query, refresh, onFilter }: { initial: Summary; field: Field; query: ListQuery; refresh: number; onFilter?: (filter: Filter) => void }) {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApiResource<Summary[]>("prayers/summary", { ...query, summaryField: field.id, summaryPage: page }, page > 1, refresh);
  const summary = page === 1 ? initial : data?.[0];
  return <section className={styles.summaryField} aria-label={`${field.name} 집계`}><div className={styles.summaryTitle}><h3><Icon name="chart" size={17} tone="sage" />{field.name}</h3><span>{initial.total}건</span></div>
    {error && <Alert>{error}</Alert>}
    {loading ? <p role="status">집계를 불러오는 중…</p> : <div className={styles.counts}>{summary?.values.map((value) => {
      const content = <><span className={styles.countLabel}>{value.label}</span><strong>{value.count}</strong></>;
      return field.isFilterable && onFilter ? <button key={JSON.stringify(value.key)} type="button" className={styles.count} style={optionStyle(field.optionColors?.[value.key ?? ""])} onClick={() => onFilter(countFilter(field, value.key))} aria-label={`${field.name} ${value.label} ${value.count}건 필터 적용`}>{content}</button> : <div key={JSON.stringify(value.key)} className={styles.count} style={optionStyle(field.optionColors?.[value.key ?? ""])}>{content}</div>;
    })}</div>}
    {initial.pages > 1 && <><Pagination page={page} pages={initial.pages} onChange={setPage} disabled={loading} /></>}
  </section>;
}
