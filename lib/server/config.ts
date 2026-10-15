import "server-only";
import { AppError } from "@/lib/domain";

export function requiredEnv(name: string, legacyName?: string): string {
  const value = (process.env[name] || (legacyName ? process.env[legacyName] : undefined))?.trim();
  if (!value) throw new AppError(503, "서비스 연결을 준비하고 있습니다. 잠시 후 다시 이용해주세요.", "NOT_CONFIGURED");
  return value;
}

/** Netlify exposes URL and SITE_ID at function runtime, unlike build-only deploy URLs. */
export function configuredAppOrigin(override?: string): string | undefined {
  const netlifyUrl = process.env.NODE_ENV === "production" && process.env.SITE_ID ? process.env.URL : undefined;
  return [override, process.env.NEXT_PUBLIC_APP_ORIGIN, netlifyUrl, process.env.NEXT_PUBLIC_APP_ORIGIN]
    .map((value) => value?.trim()).find(Boolean);
}
