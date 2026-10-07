import type { Role } from "./domain";
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch(`/api/${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    headers: body !== undefined && !form ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ error: "응답을 확인할 수 없습니다. 다시 시도해주세요." }));
  if (!response.ok) {
    if (response.status === 401 && path !== "session") window.dispatchEvent(new Event("prayer-session-expired"));
    throw new ApiError(data.error ?? "요청을 처리하지 못했습니다.", response.status, data.code);
  }
  return data as T;
}
export const messageOf = (error: unknown) => error instanceof Error ? error.message : "다시 시도해주세요.";
export type SessionResponse = { role: Role | null };
