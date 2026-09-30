import { randomInt } from "node:crypto";
import { issueToken } from "../lib/session-token";
import { Router } from "express";
import { db, ownersTable, ownerOtpTable } from "@workspace/db";
import { eq, and, gt, desc } from "drizzle-orm";

const router = Router();

function generateCode() {
  return String(randomInt(100000, 1000000));
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***@${domain}`;
}

async function sendEmail(to: string, ownerName: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#f8fafc;padding:32px;border-radius:12px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:22px;font-weight:700;color:#0f2a3f">YallaStay</div>
        <div style="font-size:13px;color:#64748b">Holiday Homes · Owner Portal</div>
      </div>
      <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e2e8f0">
        <p style="margin:0 0 12px;color:#1e293b">Hi ${ownerName},</p>
        <p style="margin:0 0 20px;color:#475569">Your one-time access code for the YallaStay Owner Portal is:</p>
        <div style="background:#0f2a3f;color:#5eead4;font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;border-radius:8px;margin:0 0 20px">
          ${code}
        </div>
        <p style="margin:0 0 8px;color:#64748b;font-size:13px">This code expires in <strong>15 minutes</strong> and can only be used once.</p>
        <p style="margin:0;color:#94a3b8;font-size:12px">If you didn't request this code, please ignore this email.</p>
      </div>
      <div style="text-align:center;margin-top:20px;color:#94a3b8;font-size:11px">
        YallaStay Holiday Homes — Owners Come First
      </div>
    </div>
  `;

  if (!apiKey) {
    throw new Error("Owner email delivery is not configured");
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || "YallaStay Portal <noreply@yallastay.ae>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [to], subject: `${code} — Your YallaStay Owner Portal Code`, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    throw new Error("Failed to send email");
  }
}

// POST /api/owner-auth/send-code
// Body: { ownerId: number }
router.post("/owner-auth/send-code", async (req, res) => {
  const { ownerId, email } = req.body;
  if (!ownerId && !email) return res.status(400).json({ error: "Email required" });

  const [owner] = await db.select().from(ownersTable).where(email ? eq(ownersTable.email, String(email).trim().toLowerCase()) : eq(ownersTable.id, Number(ownerId)));
  if (!owner) return res.status(404).json({ error: "Owner not found" });

  if (!owner.email) {
    return res.status(422).json({ error: "no_email", message: "This owner has no email address on file. Please contact your administrator." });
  }

  if (!process.env.RESEND_API_KEY) return res.status(503).json({error:"Owner email delivery is not configured. Please contact your operator."});
  await db.update(ownerOtpTable).set({used:true}).where(eq(ownerOtpTable.ownerId,owner.id));
  // Invalidate all existing unused OTPs for this owner
  // (just let them expire — new code always wins)
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  await db.insert(ownerOtpTable).values({
    ownerId: owner.id,
    email: owner.email,
    code,
    expiresAt,
  });

  try {
    await sendEmail(owner.email, owner.name, code);
  } catch (e) {
    return res.status(500).json({ error: "email_failed", message: "Failed to send email. Please try again." });
  }

  res.json({ ok: true, ownerId: owner.id, maskedEmail: maskEmail(owner.email) });
});

// POST /api/owner-auth/verify
// Body: { ownerId: number, code: string }
router.post("/owner-auth/verify", async (req, res) => {
  const { ownerId, code } = req.body;
  if (!ownerId || !code) return res.status(400).json({ error: "ownerId and code required" });

  const now = new Date();

  // Find the latest valid OTP for this owner
  const [otp] = await db
    .select()
    .from(ownerOtpTable)
    .where(
      and(
        eq(ownerOtpTable.ownerId, Number(ownerId)),
        eq(ownerOtpTable.used, false),
        gt(ownerOtpTable.expiresAt, now),
      ),
    )
    .orderBy(desc(ownerOtpTable.createdAt))
    .limit(1);

  if (!otp) {
    return res.status(401).json({ error: "expired", message: "Code has expired or was already used. Please request a new one." });
  }

  // Increment attempts
  await db.update(ownerOtpTable).set({ attempts: otp.attempts + 1 }).where(eq(ownerOtpTable.id, otp.id));

  if (otp.attempts >= 4) {
    // Too many attempts — mark used (block it)
    await db.update(ownerOtpTable).set({ used: true }).where(eq(ownerOtpTable.id, otp.id));
    return res.status(401).json({ error: "too_many_attempts", message: "Too many incorrect attempts. Please request a new code." });
  }

  if (otp.code !== String(code).trim()) {
    const remaining = 4 - otp.attempts;
    return res.status(401).json({ error: "invalid_code", message: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` });
  }

  // Mark as used
  await db.update(ownerOtpTable).set({ used: true }).where(eq(ownerOtpTable.id, otp.id));

  // Return owner data
  const [owner] = await db.select().from(ownersTable).where(eq(ownersTable.id, Number(ownerId)));

  res.json({ ok: true, token: issueToken({id:owner.id,role:"owner_portal"}), owner: { id: owner.id, name: owner.name, email: owner.email } });
});

// POST /api/owner-auth/admin-reset
// Admin endpoint: sends a fresh code to the owner's email
// Body: { ownerId: number }
router.post("/owner-auth/admin-reset", async (req, res) => {
  const { ownerId } = req.body;
  if (!ownerId) return res.status(400).json({ error: "ownerId required" });

  const [owner] = await db.select().from(ownersTable).where(eq(ownersTable.id, Number(ownerId)));
  if (!owner) return res.status(404).json({ error: "Owner not found" });

  if (!owner.email) {
    return res.status(422).json({ error: "no_email", message: "No email address on file for this owner." });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(ownerOtpTable).values({ ownerId: owner.id, email: owner.email, code, expiresAt });

  try {
    await sendEmail(owner.email, owner.name, code);
  } catch {
    // Still return the code so admin can relay it manually in dev mode
    return res.json({ ok: true, devCode: process.env.RESEND_API_KEY ? undefined : code, emailSent: false });
  }

  res.json({ ok: true, emailSent: true });
});

// GET /api/owner-auth/owners
// Returns owners list with masked emails (for login selector)
router.get("/owner-auth/owners", async (_req, res) => {
  const owners = await db.select({ id: ownersTable.id, name: ownersTable.name, email: ownersTable.email }).from(ownersTable).orderBy(ownersTable.name);
  res.json(owners.map(o => ({ id: o.id, name: o.name, hasEmail: !!o.email, maskedEmail: o.email ? maskEmail(o.email) : null })));
});

export default router;
