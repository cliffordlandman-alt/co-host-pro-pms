import { verifyToken } from "../lib/session-token";
import { Router } from "express";
import { db, usersTable, userSessionsTable, subscriptionsTable, auditLogsTable } from "@workspace/db";
import { desc, eq, gte, sql, isNull } from "drizzle-orm";

const router = Router();

const OWNER_EMAIL = "clifford.landman@icloud.com";

function getAuthUser(req: any): { id: number; role: string; email?: string } | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = verifyToken(auth.slice(7));
    if (!payload) return null;
    return payload;
  } catch { return null; }
}

router.get("/owner-analytics", async (req, res) => {
  const authPayload = getAuthUser(req);
  if (!authPayload) return res.status(401).json({ error: "Unauthorized" });

  const [me] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, authPayload.id));
  if (!me || me.email !== OWNER_EMAIL) return res.status(403).json({ error: "Forbidden" });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const [users, sessions, activeSessions, subscriptions, todayLogins, recentSessions] = await Promise.all([
    db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
      lastLogin: usersTable.lastLogin,
    }).from(usersTable).orderBy(desc(usersTable.lastLogin)),

    db.select({
      id: userSessionsTable.id,
      userEmail: userSessionsTable.userEmail,
      userName: userSessionsTable.userName,
      userRole: userSessionsTable.userRole,
      startedAt: userSessionsTable.startedAt,
      lastSeenAt: userSessionsTable.lastSeenAt,
      endedAt: userSessionsTable.endedAt,
      durationSeconds: userSessionsTable.durationSeconds,
    }).from(userSessionsTable)
      .where(gte(userSessionsTable.startedAt, weekAgo))
      .orderBy(desc(userSessionsTable.startedAt))
      .limit(100),

    db.select({ count: sql<number>`count(*)` })
      .from(userSessionsTable)
      .where(gte(userSessionsTable.lastSeenAt, fiveMinAgo)),

    db.select().from(subscriptionsTable).orderBy(desc(subscriptionsTable.createdAt)),

    db.select({ count: sql<number>`count(*)` })
      .from(userSessionsTable)
      .where(gte(userSessionsTable.startedAt, todayStart)),

    db.select({
      userEmail: userSessionsTable.userEmail,
      userName: userSessionsTable.userName,
      startedAt: userSessionsTable.startedAt,
      lastSeenAt: userSessionsTable.lastSeenAt,
      durationSeconds: userSessionsTable.durationSeconds,
      ipAddress: userSessionsTable.ipAddress,
    }).from(userSessionsTable)
      .orderBy(desc(userSessionsTable.startedAt))
      .limit(50),
  ]);

  const perUserStats: Record<string, { totalSessions: number; totalSeconds: number }> = {};
  for (const s of sessions) {
    const key = s.userEmail ?? "unknown";
    if (!perUserStats[key]) perUserStats[key] = { totalSessions: 0, totalSeconds: 0 };
    perUserStats[key].totalSessions++;
    if (s.durationSeconds) perUserStats[key].totalSeconds += s.durationSeconds;
  }

  res.json({
    stats: {
      totalUsers: users.length,
      activeNow: Number(activeSessions[0]?.count ?? 0),
      loginsToday: Number(todayLogins[0]?.count ?? 0),
      totalSubscriptions: subscriptions.length,
    },
    users: users.map(u => ({
      ...u,
      sessions: perUserStats[u.email]?.totalSessions ?? 0,
      totalTimeSeconds: perUserStats[u.email]?.totalSeconds ?? 0,
    })),
    recentSessions,
    subscriptions,
  });
});

router.post("/session/ping", async (req, res) => {
  const authPayload = getAuthUser(req);
  if (!authPayload) return res.status(401).json({ error: "Unauthorized" });

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const [openSession] = await db.select()
    .from(userSessionsTable)
    .where(
      sql`${userSessionsTable.userId} = ${authPayload.id}
        AND ${userSessionsTable.endedAt} IS NULL
        AND ${userSessionsTable.lastSeenAt} > ${fiveMinAgo}`
    )
    .orderBy(desc(userSessionsTable.startedAt))
    .limit(1);

  if (openSession) {
    const durationSeconds = Math.round((Date.now() - new Date(openSession.startedAt!).getTime()) / 1000);
    await db.update(userSessionsTable)
      .set({ lastSeenAt: new Date(), durationSeconds })
      .where(eq(userSessionsTable.id, openSession.id));
  }

  res.json({ ok: true });
});

export default router;
