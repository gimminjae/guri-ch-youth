import { database } from "@/lib/server/database";
import { storage } from "@/lib/server/storage/s3";
import { createHandler } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = createHandler(database, storage);
async function route(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return handler(request, (await context.params).path);
}
export { route as GET, route as POST, route as PUT, route as DELETE };
