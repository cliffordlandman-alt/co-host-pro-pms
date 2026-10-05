import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const dir = path.resolve(process.env.LOCAL_DATA_DIR || ".local-data");
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "session-secret");
  try { return readFileSync(file, "utf8"); } catch {
    const value = randomBytes(48).toString("hex");
    writeFileSync(file, value, { mode: 0o600, flag: "wx" });
    return value;
  }
}
const key = secret();
const sign = (value: string) => createHmac("sha256", key).update(value).digest("base64url");
export function issueToken(user: { id: number; role: string }) {
  const body = Buffer.from(JSON.stringify({ id: user.id, role: user.role, exp: Date.now() + 7 * 86400000 })).toString("base64");
  return `${body}.${sign(body)}`;
}
export function verifyToken(token: string): { id: number; role: string; exp: number } | null {
  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return null;
    const expected = Buffer.from(sign(body));
    const supplied = Buffer.from(signature);
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
    const value = JSON.parse(Buffer.from(body, "base64").toString());
    return Number.isInteger(value.id) && value.id > 0 && typeof value.role === "string" && Number.isFinite(value.exp) && value.exp > Date.now() ? value : null;
  } catch { return null; }
}
