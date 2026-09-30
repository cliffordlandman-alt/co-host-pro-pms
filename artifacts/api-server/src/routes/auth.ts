import { issueToken, verifyToken } from "../lib/session-token";
import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const router = Router();

router.post("/auth/register", async (req, res) => {
  const { name, email, password, company, phone } = req.body as {
    name: string; email: string; password: string;
    company?: string; phone?: string; role: string;
  };

  const [{ count }] = await db.select({count: sql<number>`count(*)`}).from(usersTable);
  if (Number(count) > 0) return res.status(403).json({error: "Registration is closed. Ask your administrator to create your staff account."});
  const role = "super_admin";
  if (!name?.trim() || !email?.trim() || !password || !role) {
    return res.status(400).json({ error: "Name, email, password and role are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  const validRoles = ["super_admin", "manager", "cleaner", "accountant", "owner", "reservations", "maintenance"];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail));
  if (existing.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const [user] = await db.insert(usersTable).values({
    name: name.trim(),
    email: normalizedEmail,
    password: hashedPassword,
    role,
    phone: phone?.trim() || null,
    status: "active",
  }).returning();

  const { password: _pw, ...safeUser } = user;
  const token = issueToken(user);
  res.status(201).json({ user: safeUser, token });
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const isHashed = user.password.startsWith("$2");
  const passwordValid = isHashed
    ? await bcrypt.compare(password, user.password)
    : user.password === password;

  if (!passwordValid) return res.status(401).json({ error: "Invalid email or password" });
  if (user.status !== "active") return res.status(403).json({ error: "Account is inactive" });

  await db.update(usersTable).set({ lastLogin: new Date(), ...(!isHashed ? {password: await bcrypt.hash(password, 12)} : {}) }).where(eq(usersTable.id, user.id));

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";

  await db.execute(sql`
    INSERT INTO user_sessions (user_id, user_email, user_name, user_role, ip_address)
    VALUES (${user.id}, ${user.email}, ${user.name}, ${user.role}, ${ip})
  `);

  const { password: _pw, ...safeUser } = user;
  res.json({
    user: safeUser,
    token: issueToken(user),
  });
});

router.get("/auth/me", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
  try {
    const payload = verifyToken(auth.slice(7));
    if (!payload || payload.role === "owner_portal") return res.status(401).json({ error: "Token expired" });
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.id));
    if (!user || user.status !== "active") return res.status(401).json({ error: "User not found" });
    const { password: _pw, ...safeUser } = user;
    res.json(safeUser);
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

router.get("/users", async (_req, res) => {
  const rows = await db.select({
    id: usersTable.id, name: usersTable.name, email: usersTable.email,
    role: usersTable.role, status: usersTable.status, phone: usersTable.phone,
    lastLogin: usersTable.lastLogin, createdAt: usersTable.createdAt,
  }).from(usersTable);
  res.json(rows);
});

router.post("/users", async (req, res) => {
  const { name, email, password, role, phone } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: "Missing required fields" });
  if (typeof password !== "string" || password.length < 8 || !["admin", "manager", "reservations", "operations", "cleaner", "maintenance", "accountant"].includes(role)) return res.status(400).json({error:"Valid role and password of at least 8 characters required"});
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (existing.length > 0) return res.status(400).json({ error: "Email already exists" });
  const hashedPassword = await bcrypt.hash(password, 12);
  const [user] = await db.insert(usersTable).values({ name, email: email.toLowerCase(), password: hashedPassword, role, phone, status: "active" }).returning();
  const { password: _pw, ...safeUser } = user;
  res.status(201).json(safeUser);
});

router.patch("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => ["name", "phone", "role", "status"].includes(key)));
  if (updates.role && !["admin", "manager", "reservations", "operations", "cleaner", "maintenance", "accountant"].includes(String(updates.role))) return res.status(400).json({error:"Invalid role"});
  if (updates.status && !["active", "inactive"].includes(String(updates.status))) return res.status(400).json({error:"Invalid status"});
  if (id === res.locals.user.id && (updates.role || updates.status === "inactive")) return res.status(400).json({error:"You cannot remove your own access"});
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!user) return res.status(404).json({ error: "Not found" });
  const { password: pw2, ...safeUser } = user;
  res.json(safeUser);
});

router.delete("/users/:id", async (req, res) => {
  if (Number(req.params.id) === res.locals.user.id) return res.status(400).json({error:"You cannot delete your own account"});
  await db.delete(usersTable).where(eq(usersTable.id, parseInt(req.params.id)));
  res.status(204).end();
});

export default router;
