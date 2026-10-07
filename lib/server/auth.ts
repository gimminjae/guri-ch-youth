import "server-only";
import { AppError, ROLES, type Actor, type Role } from "@/lib/domain";
import type { Database } from "./database";

export const SESSION_COOKIE = "guri_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export function requireRole(actor: Actor | null, roles: readonly Role[] = ROLES): Actor {
  if (!actor) throw new AppError(401, "교회 구성원 인증 후 이용해주세요.", "UNAUTHORIZED");
  if (!roles.includes(actor.role)) throw new AppError(403, "이 작업을 수행할 권한이 없습니다.", "FORBIDDEN");
  return actor;
}
export function cookieValue(request: Request, name = SESSION_COOKIE) {
  return request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}
export function sessionCookie(token: string, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export async function getActor(db: Database, token: string): Promise<Actor | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const actor = await db.rpc<Omit<Actor, "token"> | null>("session", {}, token);
  return actor ? { ...actor, token } : null;
}
export async function login(db: Database, raw: Record<string, unknown>) {
  if (!ROLES.includes(raw.role as Role) || typeof raw.password !== "string") throw new AppError(400, "역할과 비밀번호를 확인해주세요.");
  return db.rpc<{ token: string; role: Role }>("login", { role: raw.role, password: raw.password });
}
export async function logout(db: Database, actor: Actor | null) {
  if (actor) await db.rpc("logout", {}, actor.token);
}
export async function changePassword(db: Database, actor: Actor, raw: Record<string, unknown>) {
  requireRole(actor, ["admin"]);
  return db.rpc("password", raw, actor.token);
}
