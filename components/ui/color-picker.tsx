"use client";
import { HexColorPicker } from "react-colorful";
import { Button, Input } from "./ui";
import styles from "./color-picker.module.css";
export function ColorPicker({ value, onChange, label, disabled }: { value?: string; onChange: (color?: string) => void; label: string; disabled?: boolean }) {
  return <details className={styles.picker}><summary aria-label={`${label} 색상`}><span className={styles.swatch} style={{ background: /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#9A6844" }} />{value || "기본색"}</summary>
    <fieldset className={styles.panel} disabled={disabled}><legend>{label} 색상</legend><HexColorPicker color={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#9A6844"} onChange={(color) => !disabled && onChange(color.toUpperCase())} />
      <Input aria-label={`${label} HEX 색상`} value={value ?? ""} placeholder="#RRGGBB" maxLength={7} pattern="#[0-9a-fA-F]{6}" onChange={(e) => onChange(e.target.value || undefined)} /><Button variant="ghost" small onClick={() => onChange(undefined)}>기본색으로</Button>
    </fieldset>
  </details>;
}
