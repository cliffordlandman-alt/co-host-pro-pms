import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const DEFAULTS: Record<string, unknown> = {
  company: {
    name: "YallaStay Holiday Homes",
    phone: "+971 50 000 0000",
    email: "hello@yallastay.ae",
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
    result[row.key] = row.value;
  }
  res.json(result);
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
