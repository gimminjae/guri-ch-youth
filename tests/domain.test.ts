import test from "node:test";
import assert from "node:assert/strict";
import { validateContent, validateField, validateListQuery, type Field, dateValid, fromCsv, toCsv } from "../lib/domain";

const makeField = (datatype: Field["datatype"], id: string): Field => ({ id, datatype, name: datatype, option: [], displaytype: [], isGroupable: true, isFilterable: true, createDateTime: "", updateDateTime: "" });
const text = makeField("string", "00000000-0000-4000-8000-000000000001");
const num = makeField("number", "00000000-0000-4000-8000-000000000002");
const bool = makeField("bool", "00000000-0000-4000-8000-000000000003");
const multi = { ...makeField("checkbox", "00000000-0000-4000-8000-000000000004"), option: ["학업", "진로"] };
test("content validation preserves false, zero and prose commas while rejecting schema violations", () => {
  const fields = [text, num, bool, multi];
  assert.deepEqual(validateContent({ [text.id]: "감사, 기도", [num.id]: 0, [bool.id]: false, [multi.id]: " 학업,진로,학업 " }, fields), { [text.id]: "감사, 기도", [num.id]: 0, [bool.id]: false, [multi.id]: "학업,진로" });
  assert.throws(() => validateContent({ [num.id]: "0" }, fields));
  assert.throws(() => validateContent({ [bool.id]: "false" }, fields));
  assert.throws(() => validateContent({ [num.id]: Infinity }, fields));
  assert.throws(() => validateContent({ [multi.id]: "학" }, fields));
  assert.throws(() => validateContent({ unknown: "value" }, fields));
  assert.throws(() => validateContent({ [text.id]: "   " }, fields));
});
test("field options cannot contain ambiguous CSV values or unsupported settings", () => {
  assert.throws(() => validateField({ ...multi, option: ["학업,진로"] }));
  assert.throws(() => validateField({ ...text, datatype: "html" }));
  assert.throws(() => validateField({ ...text, displaytype: ["script"] }));
  assert.throws(() => validateField({ ...text, isFilterable: "false" }));
  assert.equal(toCsv(["", " 학업 ", "학업", "진로"]), "학업,진로");
  assert.deepEqual(fromCsv(""), []);
  assert.equal(dateValid("2024-02-29"), true);
  assert.equal(dateValid("2025-02-29"), false);
});
test("query validation rejects disallowed fields, mismatched operators and reversed ranges", () => {
  const fields = [text, num, bool, multi];
  assert.throws(() => validateListQuery({ filters: [], groupBy: text.id, page: 1 }, [{ ...text, isGroupable: false }]));
  assert.throws(() => validateListQuery({ filters: [{ fieldId: num.id, op: "range", min: 10, max: 0 }] }, fields));
  assert.throws(() => validateListQuery({ filters: [{ fieldId: bool.id, op: "eq", value: "false" }] }, fields));
  assert.throws(() => validateListQuery({ filters: [{ fieldId: text.id, op: "contains", value: "x" }] }, [{ ...text, isFilterable: false }]));
  assert.throws(() => validateListQuery({ filters: [], page: -1 }, fields));
  assert.equal(validateListQuery({ filters: [{ fieldId: bool.id, op: "eq", value: false }] }, fields).filters[0].value, false);
});
