import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../lib/server/database";
import { AppError } from "../lib/domain";

test("Supabase RPC transport needs only URL and publishable key", async () => {
  let called = false;
  const transport: typeof fetch = async (input, init) => {
    called = true;
    assert.equal(String(input), "https://unit.supabase.co/rest/v1/rpc/prayer_api");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "sb_publishable_test");
    assert.equal(headers.get("authorization"), null, "publishable keys are not bearer JWTs");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(init?.body as string), { action: "fields", payload: {}, session_token: "session-test" });
    return Response.json({ data: [] });
  };
  const db = createDatabase("https://unit.supabase.co", "sb_publishable_test", transport);
  assert.deepEqual(await db.rpc("fields", {}, "session-test"), []);
  assert.equal(called, true);
});
test("provider failures are sanitized and domain permission errors survive transport", async () => {
  const unavailable = createDatabase("https://unit.supabase.co", "sb_publishable_test", async () => Response.json({ message: "private-database-detail" }, { status: 403 }));
  await assert.rejects(unavailable.rpc("fields"), (e: unknown) => e instanceof AppError && e.status === 503 && !e.message.includes("private-database-detail"));
  const denied = createDatabase("https://unit.supabase.co", "sb_publishable_test", async () => Response.json({ error: "권한 없음", status: 403, code: "FORBIDDEN" }));
  await assert.rejects(denied.rpc("fields"), (e: unknown) => e instanceof AppError && e.status === 403 && e.code === "FORBIDDEN");
  assert.throws(() => createDatabase("http://remote.example", "key"));
});
