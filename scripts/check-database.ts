import "./env";
import { database } from "../lib/server/database";
async function main() {
  const result = await database.rpc<{ version: number }>("health");
  if (result.version !== 3) throw new Error("공개 조회 마이그레이션을 적용해주세요. 필요한 RPC 버전: 3.");
  console.log("Supabase URL + publishable key 연결 및 RPC 설치 확인 완료.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "DB 연결 확인에 실패했습니다."); process.exitCode = 1; });
