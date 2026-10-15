import type { Field, Prayer } from "./domain";

// Keep the administrator's column order, but only show fields selected by a row.
export function listDisplayFields(fields: Field[], prayers: Prayer[]): Field[] {
  const selected = new Set(prayers.flatMap((prayer) => prayer.listdisplaydata));
  return fields.filter((field) => field.isActive && selected.has(field.id));
}
