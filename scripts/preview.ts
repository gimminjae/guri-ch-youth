/** Local-only verification server: real SQL/API logic, disposable DB and files. */
import { createServer, request as proxyRequest } from "node:http";
import { testDatabase, MemoryStorage, TEST_PASSWORDS } from "../tests/helpers";
import { login, getActor } from "../lib/server/auth";
import { fieldRevision } from "../lib/domain";
import { listFields, saveField, savePrayer } from "../lib/server/repository";
import { createHandler } from "../lib/server/http";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Preview is local-only");
  const { db, pg } = await testDatabase();
  const signedIn = await login(db, { role: "admin", password: TEST_PASSWORDS.admin });
  const actor = (await getActor(db, signedIn.token))!;
  const base = { option: [], displaytype: [], isGroupable: false, isFilterable: false };
  const name = await saveField(db, actor, { ...base, name: "이름", datatype: "string", displaytype: ["bold"] });
  const content = await saveField(db, actor, { ...base, name: "기도 내용", datatype: "string", isFilterable: true });
  const category = await saveField(db, actor, { ...base, name: "기도 분류", datatype: "selectmultibox", displaytype: ["badge", "color"], option: ["학업", "진로", "가정", "감사"], isGroupable: true, isFilterable: true });
  const answered = await saveField(db, actor, { ...base, name: "기도 응답", datatype: "bool", isGroupable: true, isFilterable: true });
  const fields = await listFields(db, actor);
  const examples = [
    { name: "테스트 구성원 A", text: "새로운 한 주를 감사한 마음으로 시작하게 해주세요. 작은 일에도 서로를 배려하는 청년회가 되기를 기도합니다.", category: "감사", answered: false },
    { name: "테스트 구성원 B", text: "중요한 선택을 앞두고 있습니다. 조급해하지 않고 주어진 자리에서 최선을 다할 수 있도록 함께 기도해주세요.", category: "진로,학업", answered: false },
    { name: "테스트 구성원 C", text: "가족과 함께하는 시간이 더 따뜻해지기를 기도합니다. 서로의 이야기를 잘 듣고 사랑을 전할 수 있게 해주세요.", category: "가정", answered: true },
    { name: "테스트 구성원 D", text: "공부와 일상 사이에서 지혜롭게 균형을 잡고 싶습니다. 준비하는 모든 과정에서 평안함을 잃지 않게 해주세요.", category: "학업", answered: false },
  ];
  for (const item of examples) await savePrayer(db, actor, { content: { [name.id]: item.name, [content.id]: item.text, [category.id]: item.category, [answered.id]: item.answered }, listdisplaydata: [name.id, content.id, category.id], fieldRevision: fieldRevision(fields) });
  const handler = createHandler(db, new MemoryStorage(), { origin: "http://localhost:3100" });
  const server = createServer(async (incoming, outgoing) => {
    if (incoming.url?.startsWith("/api/")) {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const request = new Request(`http://localhost:3100${incoming.url}`, { method: incoming.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const response = await handler(request, new URL(request.url).pathname.slice(5).split("/"));
        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch { outgoing.writeHead(500); outgoing.end("Local preview error"); }
    } else {
      const proxy = proxyRequest({ hostname: "127.0.0.1", port: 3000, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, host: "localhost:3000" } }, (response) => { outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing); });
      proxy.on("error", () => { outgoing.writeHead(502); outgoing.end("Start the Next.js server on port 3000 first."); });
      incoming.pipe(proxy);
    }
  });
  server.listen(3100, "127.0.0.1", () => console.log("Local disposable preview: http://localhost:3100 (test credentials in tests/helpers.ts)"));
  const stop = () => server.close(() => { void pg.close().finally(() => process.exit(0)); });
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Preview failed"); process.exitCode = 1; });
