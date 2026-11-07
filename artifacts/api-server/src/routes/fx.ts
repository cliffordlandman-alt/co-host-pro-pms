import { Router } from "express";
import { getFxBook, publicBook } from "../lib/fx";

const router = Router();

// Dirham rates for screens that convert as they render. Cached, refreshed daily.
router.get("/fx", async (_req, res) => {
  res.json(publicBook(await getFxBook()));
});

export default router;
