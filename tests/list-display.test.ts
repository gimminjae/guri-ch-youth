import test from "node:test";
import assert from "node:assert/strict";
import { listDisplayFields } from "../lib/list-display";
import type { Field, Prayer } from "../lib/domain";

const fields: Field[] = Array.from({ length: 40 }, (_, index) => ({
  id: `field-${index}`, name: `항목 ${index}`, datatype: "shorttext", isActive: true,
  listOrder: index, option: [], displaytype: [], optionColors: {}, isGroupable: false,
  isFilterable: false, isAggregatable: false, createDateTime: "", updateDateTime: "",
}));
const prayer = (ids: string[]): Prayer => ({ id: "prayer", content: {}, listdisplaydata: ids, createDateTime: "", updateDateTime: "" });

test("list columns include every selected field, including fields after the mobile first three", () => {
  assert.deepEqual(listDisplayFields(fields, [prayer(fields.map((f) => f.id))]), fields);
  assert.deepEqual(listDisplayFields(fields, [prayer(["field-39", "field-3"]), prayer(["field-8"])]).map((f) => f.id), ["field-3", "field-8", "field-39"]);
});

test("list columns exclude unselected, inactive and removed fields without depending on content truthiness", () => {
  const row = { ...prayer(["field-0", "field-1", "field-2", "field-3", "deleted"]), content: { "field-0": false, "field-1": 0, "field-2": "", "field-4": "상세 전용" } };
  assert.deepEqual(listDisplayFields(fields.map((f) => ({ ...f, isActive: f.id !== "field-3" })), [row]).map((f) => f.id), ["field-0", "field-1", "field-2"]);
  assert.deepEqual(listDisplayFields(fields, [prayer([])]), []);
  assert.deepEqual(listDisplayFields(fields, []), []);
});
