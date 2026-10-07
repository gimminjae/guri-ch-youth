import "server-only";
import { AppError } from "@/lib/domain";
import { requiredEnv } from "./config";

export interface Database {
  rpc<T>(action: string, payload?: Record<string, unknown>, token?: string): Promise<T>;
}
export type RpcResult<T> = { data?: T; error?: string; status?: number; code?: string };
export function unwrapRpc<T>(result: RpcResult<T>): T {
  if (result.error) throw new AppError(result.status ?? 400, result.error, result.code);
  return result.data as T;
}
// Provider transport is server-only. No SQL or database credentials cross this API.
export function createDatabase(url: string, key: string, transport: typeof fetch = fetch): Database {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new AppError(503, "Supabase 연결 설정을 확인해주세요.", "NOT_CONFIGURED");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !["", "/"].includes(endpoint.pathname)) throw new AppError(503, "Supabase Project URL을 확인해주세요.", "NOT_CONFIGURED");
  endpoint.pathname = "/rest/v1/rpc/prayer_api";
  return {
    async rpc<T>(action: string, payload = {}, token = ""): Promise<T> {
      const response = await transport(endpoint, {
        method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, session_token: token }),
      });
      if (!response.ok) {
        if (response.status === 404) throw new AppError(503, "Supabase 초기 설정이 필요합니다. SQL 설치 절차를 확인해주세요.", "RPC_NOT_INSTALLED");
        throw new AppError(503, "Supabase 연결 또는 RPC 접근 권한을 확인해주세요.", "DATABASE_UNAVAILABLE");
      }
      return unwrapRpc<T>(await response.json());
    },
  };
}
export const database: Database = {
  rpc: (action, payload, token) => createDatabase(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")).rpc(action, payload, token),
};
