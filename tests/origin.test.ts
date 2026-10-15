import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { checkOrigin, createHandler } from "../lib/server/http";
import { configuredAppOrigin } from "../lib/server/config";
import { testDatabase, MemoryStorage, TEST_PASSWORDS } from "./helpers";

const site = "https://prayer-origin-test.netlify.app";
const local = "http://localhost:3000";
function environment(t: TestContext, overrides: Record<string, string> = {}) {
  const values: Record<string, string | undefined> = { NODE_ENV: "production", APP_ORIGIN: undefined, NEXT_PUBLIC_APP_ORIGIN: undefined, SITE_ID: undefined, URL: undefined, ...overrides };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries: typeof values) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values); t.after(() => apply(previous));
}
function request(origin?: string, headers: Record<string, string> = {}) {
  return new Request(`${local}/api/prayers/query`, { method: "POST", headers: { ...(origin === undefined ? {} : { Origin: origin }), ...headers } });
}

test("Netlify runtime URL takes precedence over a legacy localhost origin", (t) => {
  environment(t, { SITE_ID: randomUUID(), URL: site, NEXT_PUBLIC_APP_ORIGIN: local });
  assert.equal(configuredAppOrigin(), site);
  assert.doesNotThrow(() => checkOrigin(request(site)));
  assert.throws(() => checkOrigin(request(local)), { status: 403, code: "INVALID_ORIGIN" });
});

test("explicit server configuration and handler overrides retain priority", (t) => {
  environment(t, { SITE_ID: randomUUID(), URL: site, APP_ORIGIN: "  https://church.example/  ", NEXT_PUBLIC_APP_ORIGIN: local });
  assert.equal(configuredAppOrigin(), "https://church.example/");
  assert.equal(configuredAppOrigin(local), local);
  assert.doesNotThrow(() => checkOrigin(request("https://church.example")));
  assert.throws(() => checkOrigin(request(site)), { code: "INVALID_ORIGIN" });
  assert.doesNotThrow(() => checkOrigin(request(local), local));
});

test("Netlify origin still rejects missing, opaque, foreign, lookalike and cross-site origins", (t) => {
  environment(t, { SITE_ID: randomUUID(), URL: site });
  for (const origin of [undefined, "null", "https://untrusted.example", `${site}.untrusted.example`, `${site}:444`, site.replace("https:", "http:"), `${site}/path`]) {
    assert.throws(() => checkOrigin(request(origin)), { status: 403, code: "INVALID_ORIGIN" });
  }
  assert.throws(() => checkOrigin(request(site, { "sec-fetch-site": "cross-site" })), { code: "INVALID_ORIGIN" });
});

test("unconfigured production cannot trust request URLs, proxy headers or unrelated URL variables", (t) => {
  environment(t, { URL: site });
  assert.equal(configuredAppOrigin(), undefined);
  assert.throws(() => checkOrigin(new Request(`${site}/api/prayers/query`, { method: "POST", headers: { Origin: site, Host: new URL(site).host, "x-forwarded-host": new URL(site).host, "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" } })), { code: "INVALID_ORIGIN" });
});

test("legacy origin remains compatible outside Netlify", (t) => {
  environment(t, { NEXT_PUBLIC_APP_ORIGIN: "https://church.example" });
  assert.doesNotThrow(() => checkOrigin(request("https://church.example")));
  assert.throws(() => checkOrigin(request(site)), { code: "INVALID_ORIGIN" });
});

test("local development still derives its origin from the request", (t) => {
  environment(t, { NODE_ENV: "development", SITE_ID: randomUUID(), URL: site });
  assert.equal(configuredAppOrigin(), undefined);
  assert.doesNotThrow(() => checkOrigin(request(local)));
  assert.throws(() => checkOrigin(request(site)), { code: "INVALID_ORIGIN" });
});

test("initial Netlify page queries succeed while mutations still require a session and a trusted origin", async (t) => {
  environment(t, { SITE_ID: randomUUID(), URL: site, NEXT_PUBLIC_APP_ORIGIN: local });
  const { db, pg } = await testDatabase(); t.after(() => pg.close());
  const handle = createHandler(db, new MemoryStorage());
  const call = (path: string, method = "GET", body?: unknown, origin = site) => handle(new Request(`${local}/api/${path}`, {
    method, headers: { Origin: origin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }), path.split("/"));
  assert.equal((await call("session")).status, 200);
  assert.equal((await call("fields")).status, 200);
  const query = await call("prayers/query", "POST", { filters: [], page: 1 });
  assert.equal(query.status, 200);
  assert.deepEqual((await query.json()).items, []);
  assert.equal((await call("prayers/summary", "POST", { filters: [] })).status, 200);
  assert.equal((await call("prayers", "POST", {})).status, 401);
  assert.equal((await call("fields", "POST", {})).status, 401);
  assert.equal((await call("prayers/query", "POST", { filters: [] }, "https://untrusted.example")).status, 403);
  const login = await call("session", "POST", { role: "member", password: TEST_PASSWORDS.member });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax;.*Secure/);
});
