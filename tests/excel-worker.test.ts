import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import path from "node:path";
import ExcelJS from "exceljs";
import { readWorkbook, type ParsedWorkbook } from "../lib/server/excel/workbook";

test("XLSX binary data survives the production workerData object spread", async (t) => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("기도부탁");
  sheet.addRow(["이름", "기도", "인원", "응답", "날짜"]);
  sheet.addRow(["00123", "함께\n기도합니다", 0, false, new Date("2026-10-15T00:00:00.000Z")]);
  sheet.getCell("E2").numFmt = "yyyy-mm-dd";
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const expected: ParsedWorkbook = {
    headers: ["이름", "기도", "인원", "응답", "날짜"],
    rows: [["00123", "함께\n기도합니다", 0, false, { date: "2026-10-15T00:00:00.000Z" }]], metadata: [],
  };
  assert.deepEqual(await readWorkbook(bytes), expected);
  // Next.js adds globals by spreading the top-level worker data. A nested byte
  // array must remain binary, even when the bundler adds unrelated properties.
  const worker = new Worker(path.join(process.cwd(), "lib/server/excel/parse-worker.mjs"), {
    workerData: { ...{ bytes }, __turbopack_globals__: { NEXT_DEPLOYMENT_ID: "local-test" } },
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  t.after(() => worker.terminate());
  const [parsed] = await once(worker, "message", { signal: AbortSignal.timeout(10000) });
  assert.deepEqual(parsed, expected);
});
