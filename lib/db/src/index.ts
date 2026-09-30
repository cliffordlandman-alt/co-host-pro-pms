import { migrate as migrateRemote } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleLocal } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import path from "node:path";
import * as schema from "./schema";

const local = !process.env.DATABASE_URL;
if (local && process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
const localClient = local ? new PGlite(path.resolve(process.env.LOCAL_DATA_DIR || ".local-data", "postgres")) : null;
const remotePool = local ? null : new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = (localClient ? drizzleLocal(localClient, { schema }) : drizzle(remotePool!, { schema })) as ReturnType<typeof drizzle<typeof schema>>;
export const pool = localClient ? { query: (query: string, params?: any[]) => localClient.query(query, params) } : remotePool!;
export async function initializeDatabase() {
  if (remotePool) await migrateRemote(drizzle(remotePool), { migrationsFolder: path.resolve(process.env.MIGRATIONS_DIR || "drizzle") });
  if (localClient) await migrate(drizzleLocal(localClient), { migrationsFolder: path.resolve(process.env.MIGRATIONS_DIR || "drizzle") });
}
export * from "./schema";
