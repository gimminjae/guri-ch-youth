"use client";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import styles from "./ui.module.css";

export const cx = (...values: (string | false | undefined | null)[]) => values.filter(Boolean).join(" ");
export function Button({ variant = "primary", small, busy, className, children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; small?: boolean; busy?: boolean }) {
  return <button type="button" {...props} disabled={disabled || busy} className={cx(styles.button, variant !== "primary" && styles[variant], small && styles.small, className)}>{busy && <span className={styles.spinner} aria-hidden="true" />}{children}</button>;
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={cx(styles.control, props.className)} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={cx(styles.control, props.className)} />; }
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={cx(styles.control, styles.textarea, props.className)} />; }
export function FormField({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return <div className={styles.field}><label className={styles.label} htmlFor={htmlFor}>{label}</label>{children}{hint && <p className={styles.hint}>{hint}</p>}</div>;
}
export function Badge({ children, accent = false }: { children: ReactNode; accent?: boolean }) { return <span className={cx(styles.badge, accent && styles.accentBadge)}>{children}</span>; }
export function Alert({ children, notice = false }: { children: ReactNode; notice?: boolean }) { return <div role={notice ? "status" : "alert"} className={cx(styles.alert, notice && styles.notice)}>{children}</div>; }
export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={id} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className={styles.dialogHeader}><h2 id={id}>{title}</h2><Button variant="ghost" small onClick={onClose} disabled={busy} aria-label="닫기">✕</Button></header>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}
export function EmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className={styles.empty}><span className={styles.emptyIcon} aria-hidden="true">✧</span><h3>{title}</h3><p>{description}</p>{children}</div>;
}
export function Pagination({ page, pages, onChange, disabled }: { page: number; pages: number; onChange: (page: number) => void; disabled?: boolean }) {
  if (pages <= 1 && page === 1) return null;
  return <nav className={styles.pagination} aria-label="페이지 이동"><Button small variant="secondary" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>이전</Button><span>{page} / {pages}</span><Button small variant="secondary" disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>다음</Button></nav>;
}
