import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("SQL Editor installer seeds missing roles without password length rules and preserves credentials", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "guri-rpc-setup-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "supabase"));
  await cp("supabase/migrations", join(cwd, "supabase/migrations"), { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(NEXT_PUBLIC_)?INITIAL_/.test(key) || key === "CRON_SECRET") delete env[key];
  const longPassword = "한글!".repeat(100) + "끝";
  await writeFile(join(cwd, ".env"), `INITIAL_MEMBER_PASSWORD="1"\nNEXT_PUBLIC_INITIAL_SUB_ADMIN_PASSWORD="2"\nINITIAL_ADMIN_PASSWORD="${longPassword}"\n`);
  // .env.local has precedence over .env; quotes/dollar signs remain literal SQL data.
  const password = "  한글'$$ ♥  ";
  await writeFile(join(cwd, ".env.local"), `INITIAL_MEMBER_PASSWORD="${password}"\n`);
  const command = ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/prepare-database.ts")];
  const run = (args: string[] = []) => execFileSync(process.execPath, [...command, ...args], { cwd, env, encoding: "utf8" });
  assert.match(run(["--schema-only"]), /초기 비밀번호는 포함하지 않았습니다/);
  const output = join(cwd, ".local/supabase-setup.sql");
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const pg = new PGlite({ extensions: { pgcrypto } }); t.after(() => pg.close());
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await pg.exec(await readFile(output, "utf8"));
  assert.equal((await pg.query("SELECT id FROM prayer_private.password")).rows.length, 0);
  assert.match(run(["--passwords-only"]), /세 역할의 비밀번호 등록/);
  const seed = join(cwd, ".local/supabase-passwords.sql");
  assert.equal((await stat(seed)).mode & 0o777, 0o600);
  await pg.exec(await readFile(seed, "utf8"));
  assert.deepEqual((await pg.query("SELECT id FROM prayer_private.password ORDER BY id")).rows, [{ id: "admin" }, { id: "member" }, { id: "sub-admin" }]);
  const before = await pg.query("SELECT pw FROM prayer_private.password WHERE id='member'");
  await pg.exec(await readFile(seed, "utf8"));
  assert.match(run(), /SQL Editor/);
  await pg.exec(await readFile(output, "utf8"));
  assert.deepEqual(await pg.query("SELECT pw FROM prayer_private.password WHERE id='member'"), before);
  for (const [role, value] of Object.entries({ member: password, "sub-admin": "2", admin: longPassword })) {
    const result = await pg.query<{ result: { data?: { role: string } } }>("SELECT public.prayer_api('login',$1::jsonb) result", [JSON.stringify({ role, password: value })]);
    assert.equal(result.rows[0].result.data?.role, role);
  }
  // Missing configuration must fail instead of silently generating another empty seed.
  await writeFile(join(cwd, ".env"), ""); await writeFile(join(cwd, ".env.local"), "");
  const missing = spawnSync(process.execPath, [...command, "--passwords-only"], { cwd, env, encoding: "utf8" });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /초기 비밀번호를 설정해주세요/);
});
