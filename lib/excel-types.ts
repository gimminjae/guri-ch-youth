import type { Content, Field } from "./domain";
export type ExcelMode = "add" | "update";
export type ExcelCell = string | number | boolean | null;
export type ExcelColumn = { header: string; suggested: string };
export type ExcelInspection = { columns: ExcelColumn[]; samples: ExcelCell[][]; rowCount: number; fields: Field[] };
export type ExcelPreview = { jobId: string | null; mode: ExcelMode; count: number; errors: { row: number; message: string }[]; rows: { row: number; content: Content; cleared: string[] }[] };
