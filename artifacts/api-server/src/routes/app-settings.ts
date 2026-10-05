import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { BRAND, documentName } from "../../../../lib/brand.mjs";

const router = Router();

const DEFAULTS: Record<string, unknown> = {
  company: {
    name: "",
    // Settings → Company → "Company name on documents": owner statements, their PDFs, the Owner Portal and owner emails.
    documentName: BRAND,
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
  res.json({ appName: BRAND, documentName: await documentCompanyName() });
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
