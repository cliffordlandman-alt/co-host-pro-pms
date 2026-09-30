import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";

const router = Router();

// GET /api/pricing/rules -> returns all property pricing rules
router.get("/pricing/rules", async (req, res) => {
  try {
    const rules = await db
      .select()
      .from(appSettingsTable)
      .where(like(appSettingsTable.key, "pricing_rules_%"));
    
    // Map keys like "pricing_rules_1" to { propertyId: 1, rules: value }
    const result = rules.map(row => {
      const propertyId = parseInt(row.key.replace("pricing_rules_", ""), 10);
      return { propertyId, rules: row.value };
    });
    
    res.json(result);
  } catch (error) {
    console.error("Error fetching pricing rules:", error);
    res.status(500).json({ error: "Failed to fetch pricing rules" });
  }
});

// GET /api/pricing/rules/:propertyId -> returns rules for one property
router.get("/pricing/rules/:propertyId", async (req, res): Promise<void> => {
  try {
    const { propertyId } = req.params;
    const key = `pricing_rules_${propertyId}`;
    const rule = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, key))
      .limit(1);

    if (rule.length === 0) {
      res.status(404).json({ error: "Pricing rules not found for this property" });
      return;
    }

    res.json(rule[0].value);
  } catch (error) {
    console.error("Error fetching pricing rule:", error);
    res.status(500).json({ error: "Failed to fetch pricing rule" });
  }
});

// PUT /api/pricing/rules/:propertyId -> upserts rules
router.put("/pricing/rules/:propertyId", async (req, res) => {
  try {
    const { propertyId } = req.params;
    const rules = req.body;
    const key = `pricing_rules_${propertyId}`;

    const existing = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, key))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(appSettingsTable)
        .set({ value: rules, updatedAt: new Date() })
        .where(eq(appSettingsTable.key, key));
    } else {
      await db.insert(appSettingsTable).values({
        key,
        value: rules,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error upserting pricing rules:", error);
    res.status(500).json({ error: "Failed to save pricing rules" });
  }
});

export default router;
