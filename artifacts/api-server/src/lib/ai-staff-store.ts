import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getJson<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return (row?.value as T) ?? fallback;
}
export async function setJson(key: string, value: unknown) {
  const [ex] = await db.select({ key: appSettingsTable.key }).from(appSettingsTable).where(eq(appSettingsTable.key, key));
  if (ex) await db.update(appSettingsTable).set({ value: value as any, updatedAt: new Date() }).where(eq(appSettingsTable.key, key));
  else await db.insert(appSettingsTable).values({ key, value: value as any });
}
export type BotConf = { email?: string | null; webhookUrl?: string | null; keyHash?: string | null; keyCreatedAt?: string | null };
export type StaffConfig = { plan: string; enabled: Record<string, boolean>; bots: Record<string, BotConf> };
export const CONFIG_KEY = "ai-staff:config";
export const defaultConfig = (): StaffConfig => ({ plan: "full_ops", enabled: {}, bots: {} });
export const getConfig = () => getJson<StaffConfig>(CONFIG_KEY, defaultConfig());
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export function newBotKey(bot: string) { const key = `${bot}.${randomBytes(24).toString("base64url")}`; return { key, hash: sha(key) }; }
/** "X-Bot-Key: <bot>.<secret>" -> bot id when it matches the stored hash, else null. */
export async function verifyBotKey(header: unknown): Promise<string | null> {
  if (typeof header !== "string" || !header.includes(".")) return null;
  const bot = header.split(".")[0]; const conf = (await getConfig()).bots?.[bot];
  if (!conf?.keyHash) return null;
  const a = Buffer.from(sha(header)), b = Buffer.from(conf.keyHash);
  return a.length === b.length && timingSafeEqual(a, b) ? bot : null;
}
