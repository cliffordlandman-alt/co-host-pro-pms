import { verifyToken } from "../lib/session-token";
import { Request, Response, NextFunction } from "express";
import { db, usersTable, subscriptionsTable, propertiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export const PLAN_PROPERTY_LIMITS: Record<string, number> = {
  starter: 10,
  basic:   10,
  growth:  50,
  pro:     Infinity,
  enterprise: Infinity,
};
export const DEFAULT_PROPERTY_LIMIT = 10;

/**
 * Decode the bearer token and return its payload.
 *
 * Token format: base64-encoded JSON `{ id, role, exp }` where `exp` is a
 * Unix timestamp in **milliseconds** (not seconds — this is a custom format,
 * not standard JWT). Set by the auth route as `Date.now() + 86400000 * 7`.
 */
export function getTokenPayload(req: Request): { id: number; role: string; exp: number } | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = verifyToken(auth.slice(7));
    // exp is milliseconds — compare directly to Date.now()
    if (!payload) return null;
    return payload;
  } catch { return null; }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const payload = getTokenPayload(req);
  if (!payload || payload.role === "owner_portal") return res.status(401).json({ error: "Unauthorized" });

  // Re-fetch role from the DB so stale tokens cannot escalate privilege
  const [user] = await db
    .select({ role: usersTable.role, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.id, payload.id));

  if (!user || user.status !== "active" || (user.role !== "admin" && user.role !== "super_admin")) {
    return res.status(403).json({ error: "Forbidden: admin access only" });
  }
  return next();
}

export async function checkPropertyLimit(req: Request, res: Response, next: NextFunction) {
  const payload = getTokenPayload(req);
  if (!payload || payload.role === "owner_portal") return res.status(401).json({ error: "Unauthorized" });

  const [[{ count }], [activeSub]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(propertiesTable),
    db.select({ plan: subscriptionsTable.plan, status: subscriptionsTable.status })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.status, "active"))
      .limit(1),
  ]);

  if (!activeSub) return next();
  const propertyCount = Number(count);
  const plan = activeSub?.plan ?? "starter";
  const limit = PLAN_PROPERTY_LIMITS[plan] ?? DEFAULT_PROPERTY_LIMIT;

  if (isFinite(limit) && propertyCount >= limit) {
    return res.status(403).json({
      error: "Property limit reached",
      propertyLimitReached: true,
      limit,
      plan,
      message: `You've reached your ${limit}-property limit. Upgrade your plan to add more properties.`,
    });
  }
  return next();
}
