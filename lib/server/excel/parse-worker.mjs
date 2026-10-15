/* Bounded worker isolates ZIP/XML parsing from the request event loop. */
import { parentPort, workerData } from 'node:worker_threads';
import ExcelJS from 'exceljs';
(async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(workerData.bytes));
  if (workbook.worksheets.length > 8) throw Error('시트는 최대 8개까지 지원합니다.');
  const sheet = workbook.getWorksheet('기도부탁') || workbook.worksheets.find((s) => s.state === 'visible');
  if (!sheet || sheet.rowCount > 501 || sheet.columnCount > 43) throw Error('엑셀은 머리글 1행과 데이터 500행·43열까지 지원합니다.');
  const cellValue = (cell) => {
    const value = cell.value;
    if (value == null) return null;
    if (value instanceof Date) return { date: value.toISOString() };
    if (['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (value.richText) return value.richText.map((part) => part.text).join('');
    throw Error(`${cell.address}: 수식·링크·오류 셀은 일반 값으로 바꿔주세요.`);
  };
  for (const s of workbook.worksheets) {
    if (s.rowCount > 30000 || s.columnCount > 43 || Object.keys(s.model.merges || {}).length) throw Error('시트 크기가 너무 크거나 병합된 셀이 있습니다.');
    s.eachRow((r) => r.eachCell((c) => { if (c.formula || c.type === ExcelJS.ValueType.Formula) throw Error('수식은 지원하지 않습니다.'); }));
  }
  const headers = Array.from({ length: sheet.columnCount }, (_, i) => String(cellValue(sheet.getRow(1).getCell(i + 1)) || ''));
  if (!headers.length || headers.some((h) => !h || h.length > 100)) throw Error('모든 열에 100자 이내 머리글을 입력해주세요.');
  const rows = [];
  for (let row = 2; row <= sheet.rowCount; row++) rows.push(Array.from({ length: sheet.columnCount }, (_, i) => cellValue(sheet.getRow(row).getCell(i + 1))));
  while (rows.length && rows[rows.length - 1].every((v) => v == null || v === '')) rows.pop();
  const metaSheet = workbook.getWorksheet('_기도_설정');
  const metadata = [];
  if (metaSheet && metaSheet.getCell('A1').value === 'guri-prayer-v1') {
    for (let row = 2; row <= metaSheet.rowCount; row++) metadata.push([String(metaSheet.getRow(row).getCell(1).value || ''), String(metaSheet.getRow(row).getCell(2).value || '')]);
  }
  parentPort.postMessage({ headers, rows, metadata });
})().catch((error) => parentPort.postMessage({ error: error.message }));
