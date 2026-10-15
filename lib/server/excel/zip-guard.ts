import "server-only";
import { inflateRawSync } from "node:zlib";
import { AppError } from "@/lib/domain";
export const EXCEL_LIMITS = { fileBytes: 5 * 1024 * 1024, uncompressedBytes: 20 * 1024 * 1024, entries: 160, rows: 500, columns: 43, timeoutMs: 10000 };
const bad = () => { throw new AppError(400, "안전하게 읽을 수 있는 일반 .xlsx 파일을 사용해주세요. 수식·매크로·외부 참조·병합 셀은 지원하지 않습니다."); };
/** Validate actual inflated sizes before ExcelJS allocates workbook objects. ZIP64/encryption are unnecessary for these limits. */
export function guardXlsx(input: Uint8Array) {
  const bytes = Buffer.from(input);
  if (!bytes.length || bytes.length > EXCEL_LIMITS.fileBytes) throw new AppError(413, "엑셀 파일은 최대 5MB까지 업로드할 수 있습니다.");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) bad();
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (!count || count > EXCEL_LIMITS.entries || start + centralSize !== end || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count) bad();
  let offset = start, inflated = 0; const names = new Set<string>();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) bad();
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24), nameSize = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
    if (offset + 46 + nameSize + extra + comment > end || flags & 1 || ![0, 8].includes(method) || size > EXCEL_LIMITS.uncompressedBytes || local + 30 > start) bad();
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString("utf8");
    if (names.has(name) || /\.\.|\\|^\/|vba|externalLinks|embeddings|activeX|connections|queryTables/i.test(name)) bad();
    names.add(name);
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method) bad();
    const localNameSize = bytes.readUInt16LE(local + 26), dataStart = local + 30 + localNameSize + bytes.readUInt16LE(local + 28);
    if (dataStart + compressed > start || bytes.subarray(local + 30, local + 30 + localNameSize).toString("utf8") !== name) bad();
    let content: Buffer;
    try { content = method === 8 ? inflateRawSync(bytes.subarray(dataStart, dataStart + compressed), { maxOutputLength: EXCEL_LIMITS.uncompressedBytes - inflated + 1 }) : bytes.subarray(dataStart, dataStart + compressed); } catch { bad(); }
    inflated += content!.length;
    if (content!.length !== size || inflated > EXCEL_LIMITS.uncompressedBytes) throw new AppError(413, "압축 해제한 엑셀 크기가 20MB를 넘습니다. 파일을 나누어주세요.");
    if (/\.(xml|rels)$/i.test(name)) {
      const xml = content!.toString("utf8");
      if (/<!DOCTYPE|<!ENTITY|<(?:(?:\w+):)?f(?:\s|>)|<(?:(?:\w+):)?mergeCell\b|TargetMode\s*=\s*["']External|macroEnabled/i.test(xml)) bad();
      if (/worksheets\/sheet\d+\.xml$/.test(name)) {
        const cells = [...xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)];
        if (cells.length > 150000 || cells.some((m) => Number(m[2]) > 30000 || m[1].length > 2)) throw new AppError(413, "엑셀의 행·셀 수가 너무 많습니다. 빈 서식 영역을 제거하거나 파일을 나누어주세요.");
      }
    }
    offset += 46 + nameSize + extra + comment;
  }
  if (offset !== end || !names.has("xl/workbook.xml") || !names.has("[Content_Types].xml")) bad();
}
