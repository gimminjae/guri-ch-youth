import "./env";
import { readdir, readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";

const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) if (!["--existing-schema", "--reset-passwords", "--schema-only", "--passwords-only"].includes(arg)) throw new Error("지원하지 않는 옵션입니다.");
  const roles = { member: "INITIAL_MEMBER_PASSWORD", "sub-admin": "INITIAL_SUB_ADMIN_PASSWORD", admin: "INITIAL_ADMIN_PASSWORD" };
  // Bootstrap runs only in Node. Support existing prefixed names without changing values.
  const passwordValue = (name: string) => process.env[name] ?? process.env[`NEXT_PUBLIC_${name}`];
  const reset = args.has("--reset-passwords");
  const schemaOnly = args.has("--schema-only");
  const passwordsOnly = args.has("--passwords-only");
  if (schemaOnly && reset) throw new Error("--schema-only와 --reset-passwords는 함께 사용할 수 없습니다.");
  if (passwordsOnly && (schemaOnly || args.has("--existing-schema"))) throw new Error("--passwords-only는 --schema-only 또는 --existing-schema와 함께 사용할 수 없습니다.");
  if (!schemaOnly) {
    const missing = Object.values(roles).filter((name) => !passwordValue(name));
    if (missing.length) throw new Error(`초기 비밀번호를 설정해주세요: ${missing.join(", ")}. 비밀번호 없이 DB 구조만 준비하려면 --schema-only를 사용해주세요.`);
  }
  const statements = [
    "-- Generated for Supabase SQL Editor. Contains initial passwords; keep this file private.",
    "BEGIN;", "SET LOCAL standard_conforming_strings = on;",
  ];
  if (!passwordsOnly) statements.push(
    "CREATE SCHEMA IF NOT EXISTS prayer_migrations;",
    "REVOKE ALL ON SCHEMA prayer_migrations FROM PUBLIC, anon, authenticated, service_role;",
    "CREATE TABLE IF NOT EXISTS prayer_migrations.history(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());",
    "REVOKE ALL ON ALL TABLES IN SCHEMA prayer_migrations FROM PUBLIC, anon, authenticated, service_role;",
  );
  else statements.push(`DO $password_setup$
BEGIN
 IF to_regprocedure('prayer_private.password_hash(text)') IS NULL THEN RAISE EXCEPTION '먼저 db:prepare로 생성한 DB 설치 SQL을 실행해주세요.'; END IF;
END $password_setup$;`);
  const files = passwordsOnly ? [] : (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const [index, name] of files.entries()) {
    const sql = await readFile(`supabase/migrations/${name}`, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const adopt = index === 0 && args.has("--existing-schema");
    statements.push(`DO $migration_guard$
BEGIN
 IF EXISTS(SELECT FROM prayer_migrations.history WHERE name=${quote(name)} AND checksum<>${quote(checksum)}) THEN RAISE EXCEPTION 'An applied migration was modified'; END IF;
 IF NOT EXISTS(SELECT FROM prayer_migrations.history WHERE name=${quote(name)}) THEN
 ${adopt ? "IF to_regclass('public.praycontent') IS NULL OR to_regclass('public.praycontentfield') IS NULL OR to_regclass('prayer_private.password') IS NULL THEN RAISE EXCEPTION 'Existing base schema not found'; END IF;" : `EXECUTE $migration_sql$${sql}$migration_sql$;`}
 INSERT INTO prayer_migrations.history(name,checksum) VALUES(${quote(name)},${quote(checksum)});
 END IF;
END $migration_guard$;`);
  }
  let credentials = 0;
  for (const [role, env] of Object.entries(roles)) {
    if (schemaOnly) continue;
    const pw = passwordValue(env);
    if (!pw) continue;
    credentials++;
    statements.push(`INSERT INTO prayer_private.password(id,pw) VALUES(${quote(role)},prayer_private.password_hash(${quote(pw)})) ON CONFLICT(id) ${reset ? 'DO UPDATE SET pw=EXCLUDED.pw, "sessionVersion"=prayer_private.password."sessionVersion"+1,"updateDateTime"=now()' : 'DO NOTHING'};`);
    if (reset) statements.push(`DELETE FROM prayer_private.sessions WHERE role=${quote(role)};`);
  }
  const cron = process.env.CRON_SECRET;
  if (cron && !schemaOnly && !passwordsOnly) {
    if (cron.length < 32) throw new Error("CRON_SECRET은 32자 이상으로 설정해주세요.");
    statements.push(`INSERT INTO prayer_private.settings(key,value) VALUES('cron_hash',${quote(createHash("sha256").update(cron).digest("hex"))}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;`);
  }
  statements.push("COMMIT;");
  if (passwordsOnly) statements.push('-- Confirm role registration without exposing password hashes.', 'SELECT id, "createDateTime" FROM prayer_private.password ORDER BY id;');
  else statements.push("-- Check RPC installation (safe public health query).", "SELECT public.prayer_api('health');");
  await mkdir(".local", { recursive: true });
  const output = passwordsOnly ? ".local/supabase-passwords.sql" : ".local/supabase-setup.sql";
  await writeFile(output, statements.join("\n\n") + "\n", { mode: 0o600 });
  await chmod(output, 0o600);
  console.log(`${output} 생성 완료. Supabase SQL Editor에서 전체 내용을 한 번 실행해주세요. 이 명령은 DB를 변경하지 않습니다.`);
  if (!credentials) console.log("초기 비밀번호는 포함하지 않았습니다. 새 DB의 로그인을 사용하려면 INITIAL_*_PASSWORD 세 값을 설정하고 다시 생성해주세요.");
  else console.log(`세 역할의 비밀번호 ${reset ? "재설정" : "등록"} SQL을 포함했습니다.${reset ? " 적용하면 기존 인증 세션이 해제됩니다." : " 이미 등록된 역할의 비밀번호는 변경하지 않습니다."}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "SQL 생성에 실패했습니다."); process.exitCode = 1; });
