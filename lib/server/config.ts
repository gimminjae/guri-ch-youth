import "server-only";
import { AppError } from "@/lib/domain";

export function requiredEnv(name: string, legacyName?: string): string {
  const value = (process.env[name] || (legacyName ? process.env[legacyName] : undefined))?.trim();
  if (!value) throw new AppError(503, "서비스 연결을 준비하고 있습니다. 잠시 후 다시 이용해주세요.", "NOT_CONFIGURED");
  return value;
}
