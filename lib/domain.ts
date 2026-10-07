export const DATA_TYPES = ["selectbox", "selectmultibox", "checkbox", "string", "number", "date", "image", "file", "bool"] as const;
export type DataType = (typeof DATA_TYPES)[number];
export const DISPLAY_TYPES = ["badge", "bold", "color"] as const;
export type DisplayType = (typeof DISPLAY_TYPES)[number];
export const ROLES = ["member", "sub-admin", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { member: "교회 구성원", "sub-admin": "부관리자", admin: "관리자" };
export const TYPE_LABELS: Record<DataType, string> = {
  selectbox: "하나 선택", selectmultibox: "여러 개 선택", checkbox: "체크박스 그룹",
  string: "글", number: "숫자", date: "날짜", image: "이미지", file: "파일", bool: "예 / 아니오",
};
export type Value = string | number | boolean;
export type Content = Record<string, Value>;
export type FieldInput = { name: string; datatype: DataType; displaytype: DisplayType[]; option: string[]; isGroupable: boolean; isFilterable: boolean };
export type Field = FieldInput & { id: string; createDateTime: string; updateDateTime: string };
export type Prayer = { id: string; content: Content; listdisplaydata: string[]; createDateTime: string; updateDateTime: string };
export type Actor = { role: Role; sessionId: string; token: string };
export type Filter = { fieldId: string; op: "eq" | "contains" | "in" | "range" | "empty" | "present"; value?: string | number | boolean | string[]; min?: string | number; max?: string | number };
export type ListQuery = { filters: Filter[]; groupBy?: string; groupKey?: string | null; page: number };
export type Group = { key: string | null; label: string; count: number };
export type ListResult = { items: Prayer[]; groups: Group[]; total: number; page: number; pages: number; groupCount: number; groupPages: number };
export const PAGE_SIZE = 12;
export const LIMITS = { fields: 40, options: 60, text: 10000, fileBytes: 4 * 1024 * 1024 };
export const isChoice = (type: DataType) => ["selectbox", "selectmultibox", "checkbox"].includes(type);
export const isMulti = (type: DataType) => type === "selectmultibox" || type === "checkbox";
export const isFile = (type: DataType) => type === "image" || type === "file";
export const canManage = (role?: Role | null) => role === "admin" || role === "sub-admin";
export const fromCsv = (value: string) => [...new Set(value.split(",").map((v) => v.trim()).filter(Boolean))];
export const toCsv = (values: readonly string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))].join(",");
export const fieldRevision = (fields: Field[]) => fields.map((f) => `${f.id}:${f.updateDateTime}`).join("|");
export function valueText(field: Field, value?: Value): string {
  if (value === undefined || value === "") return "미입력";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (isMulti(field.datatype)) return fromCsv(String(value)).join(" · ");
  if (isFile(field.datatype)) return field.datatype === "image" ? "첨부 이미지" : "첨부파일";
  return String(value);
}

export class AppError extends Error {
  constructor(public status: number, message: string, public code = "INVALID_REQUEST") { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(400, "입력 형식이 올바르지 않습니다.");
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AppError(400, "항목 식별자가 올바르지 않습니다.");
  return value;
}
export function dateValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function stringArray(value: unknown, max = LIMITS.options): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((v) => typeof v !== "string")) throw new AppError(400, "선택 항목을 확인해주세요.");
  return [...new Set(value.map((v: string) => v.trim()).filter(Boolean))];
}
export function validateField(raw: unknown): FieldInput {
  const input = object(raw);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100) throw new AppError(400, "필드 이름은 1~100자로 입력해주세요.");
  if (!DATA_TYPES.includes(input.datatype as DataType)) throw new AppError(400, "지원하지 않는 필드 타입입니다.");
  const datatype = input.datatype as DataType;
  const displaytype = stringArray(input.displaytype, 3) as DisplayType[];
  if (displaytype.some((v) => !DISPLAY_TYPES.includes(v))) throw new AppError(400, "표시 방식을 확인해주세요.");
  const option = stringArray(input.option);
  if (option.some((v) => v.includes(",") || v.length > 100)) throw new AppError(400, "선택지는 100자 이내로 입력하고 쉼표는 제외해주세요.");
  if (isChoice(datatype) && !option.length) throw new AppError(400, "선택지를 하나 이상 입력해주세요.");
  if (!isChoice(datatype) && option.length) throw new AppError(400, "선택형 필드에만 선택지를 지정할 수 있습니다.");
  if (typeof input.isGroupable !== "boolean" || typeof input.isFilterable !== "boolean") throw new AppError(400, "그룹화·필터링 설정을 확인해주세요.");
  return { name: input.name.trim(), datatype, displaytype, option, isGroupable: input.isGroupable, isFilterable: input.isFilterable };
}
export function validateContent(raw: unknown, fields: Field[]): Content {
  const input = object(raw);
  const result: Content = {};
  for (const [key, value] of Object.entries(input)) {
    const field = fields.find((f) => f.id === key);
    if (!field) throw new AppError(409, "필드 구성이 바뀌었습니다. 새로고침 후 다시 작성해주세요.", "FIELDS_CHANGED");
    if (value === undefined || value === null || value === "") continue;
    const fail = () => { throw new AppError(400, `${field.name}: 입력값을 확인해주세요.`); };
    if (field.datatype === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e15) fail();
    } else if (field.datatype === "bool") {
      if (typeof value !== "boolean") fail();
    } else {
      if (typeof value !== "string" || value.length > LIMITS.text) fail();
      const text = value as string;
      if (field.datatype === "date" && !dateValid(text)) fail();
      if (field.datatype === "selectbox" && !field.option.includes(text)) fail();
      if (isMulti(field.datatype)) {
        const values = fromCsv(text);
        if (values.some((v) => !field.option.includes(v))) fail();
        if (values.length) result[key] = toCsv(values);
        continue;
      }
      if (isFile(field.datatype)) uuid(text);
      if (field.datatype === "string" && !text.trim()) continue;
    }
    result[key] = value as Value;
  }
  if (!Object.keys(result).length) throw new AppError(400, "기도 내용을 한 항목 이상 입력해주세요.");
  return result;
}
export function validateListQuery(raw: unknown, fields: Field[]): ListQuery {
  const input = object(raw);
  const page = input.page ?? 1;
  if (!Number.isInteger(page) || (page as number) < 1 || (page as number) > 100000) throw new AppError(400, "페이지 번호를 확인해주세요.");
  const groupBy = input.groupBy ? uuid(input.groupBy) : undefined;
  if (groupBy && !fields.some((f) => f.id === groupBy && f.isGroupable)) throw new AppError(409, "그룹화 설정이 변경되었습니다. 조회 조건을 초기화해주세요.", "FIELDS_CHANGED");
  if (input.groupKey !== undefined && (!groupBy || (input.groupKey !== null && (typeof input.groupKey !== "string" || input.groupKey.length > LIMITS.text)))) throw new AppError(400, "그룹을 확인해주세요.");
  if (!Array.isArray(input.filters) || input.filters.length > LIMITS.fields) throw new AppError(400, "필터 조건을 확인해주세요.");
  const filters: Filter[] = [];
  for (const rawFilter of input.filters) {
    const f = object(rawFilter);
    const fieldId = uuid(f.fieldId);
    const field = fields.find((v) => v.id === fieldId && v.isFilterable);
    if (!field) throw new AppError(409, "필터 설정이 변경되었습니다. 조회 조건을 초기화해주세요.", "FIELDS_CHANGED");
    if (filters.some((v) => v.fieldId === fieldId)) throw new AppError(400, "동일한 필드의 필터를 중복할 수 없습니다.");
    const op = f.op;
    const invalid = () => { throw new AppError(400, `${field.name}: 필터 조건을 확인해주세요.`); };
    if (op === "empty" || op === "present") { filters.push({ fieldId, op }); continue; }
    if (isChoice(field.datatype)) {
      if (op !== "in") invalid();
      const values = stringArray(f.value);
      if (!values.length || values.some((v) => !field.option.includes(v))) invalid();
      filters.push({ fieldId, op: "in", value: values });
    } else if (field.datatype === "string") {
      if (op !== "contains" || typeof f.value !== "string" || !f.value.trim() || f.value.length > 500) invalid();
      filters.push({ fieldId, op: "contains", value: (f.value as string).trim() });
    } else if (field.datatype === "bool") {
      if (op !== "eq" || typeof f.value !== "boolean") invalid();
      filters.push({ fieldId, op: "eq", value: f.value as boolean });
    } else if (field.datatype === "date" || field.datatype === "number") {
      const valid = (v: unknown) => field.datatype === "number" ? typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e15 : typeof v === "string" && dateValid(v);
      if (op === "eq") {
        if (!valid(f.value)) invalid();
        filters.push({ fieldId, op: "eq", value: f.value as string | number });
      } else if (op === "range") {
        if (f.min === undefined && f.max === undefined) invalid();
        if ((f.min !== undefined && !valid(f.min)) || (f.max !== undefined && !valid(f.max))) invalid();
        const min = f.min as string | number | undefined, max = f.max as string | number | undefined;
        if (min !== undefined && max !== undefined && min > max) invalid();
        filters.push({ fieldId, op: "range", min, max });
      } else invalid();
    } else invalid();
  }
  return { filters, groupBy, page: page as number, ...(input.groupKey !== undefined ? { groupKey: input.groupKey as string | null } : {}) };
}
