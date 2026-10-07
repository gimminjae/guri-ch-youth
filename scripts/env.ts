import { loadEnvFile } from "node:process";
// Existing shell variables win, then .env.local, then .env.
for (const file of [".env.local", ".env"]) {
  try { loadEnvFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
