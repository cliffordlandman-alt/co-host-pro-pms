import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { BRAND, PRODUCT_FULL, documentName } from "../../../../lib/brand.mjs";

const router = Router();

const DEFAULTS: Record<string, unknown> = {
  company: {
    name: "",
    // Settings → Company → "Company name on documents": owner statements, their PDFs, the Owner Portal and owner emails.
    documentName: PRODUCT_FULL,
    phone: "+971 50 000 0000",
    email: "",
    address: "Dubai Marina, Dubai, UAE",
    currency: "AED",
    vatEnabled: false,
    vatRate: 5,
  },
  booking: {
    checkInTime: "15:00",
    checkOutTime: "11:00",
    defaultSecurityDeposit: 500,
  },
  owner: {
    defaultPayoutMethod: "bank",
    minPayoutThreshold: 1000,
    payoutFrequency: "monthly",
  },
  ai: {
    enabled: true,
    tone: "professional",
    language: "English",
  },
};

// Per-user workspace mode: "full" (every module) or "simple" (essentials only). Stored in app_settings under
// "ui-mode:<userId>" (no migration). null = not chosen yet (the app asks once after login).
const UI_MODES = ["full", "simple"];
router.get("/me/ui-mode", async (req, res) => {
  const uid = (res.locals as any).user?.id ?? req.headers["x-user-id"];
  if (!uid) return res.status(401).json({ error: "Not signed in" });
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, `ui-mode:${uid}`));
  const mode = (row?.value as any)?.mode;
  res.json({ mode: UI_MODES.includes(mode) ? mode : null });
});
router.put("/me/ui-mode", async (req, res) => {
  const uid = (res.locals as any).user?.id ?? req.headers["x-user-id"];
  if (!uid) return res.status(401).json({ error: "Not signed in" });
  const mode = req.body?.mode;
  if (!UI_MODES.includes(mode)) return res.status(400).json({ error: "Mode must be full or simple" });
  const key = `ui-mode:${uid}`, value = { mode };
  const [ex] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  if (ex) await db.update(appSettingsTable).set({ value, updatedAt: new Date() }).where(eq(appSettingsTable.key, key));
  else await db.insert(appSettingsTable).values({ key, value });
  res.json({ mode });
});

router.get("/settings", async (_req, res) => {
  const rows = await db.select().from(appSettingsTable);
  const result: Record<string, unknown> = { ...DEFAULTS };
  for (const row of rows) {
    // Company: fill fields saved before they existed (e.g. documentName) from the defaults.
    result[row.key] = row.key === "company" && row.value && typeof row.value === "object" ? { ...(DEFAULTS.company as object), ...(row.value as object) } : row.value;
  }
  res.json(result);
});

/** The company name for documents and emails (Settings → Company), falling back to the product name. */
export async function documentCompanyName(): Promise<string> {
  try {
    const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "company"));
    return documentName(row?.value);
  } catch { return BRAND; }
}

// Public (no login): the product name and the company name on documents, for the login pages and the Owner Portal.
router.get("/brand", async (_req, res) => {
  let c: any = null; try { [c] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "company")); } catch { /* defaults */ }
  const v = c?.value ?? {}, logo = typeof v.logoUrl === "string" && /^(data:image\/(png|jpeg|svg\+xml|webp);base64,|https:\/\/)/.test(v.logoUrl) ? v.logoUrl : null;
  res.json({ appName: BRAND, documentName: await documentCompanyName(), workspaceName: typeof v.workspaceName === "string" && v.workspaceName.trim() ? v.workspaceName.trim().slice(0, 80) : null, logoUrl: logo });
});

router.put("/settings/:key", async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  const existing = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  if (existing.length > 0) {
    const [row] = await db.update(appSettingsTable).set({ value, updatedAt: new Date() }).where(eq(appSettingsTable.key, key)).returning();
    res.json(row);
  } else {
    const [row] = await db.insert(appSettingsTable).values({ key, value }).returning();
    res.status(201).json(row);
  }
});

export default router;
