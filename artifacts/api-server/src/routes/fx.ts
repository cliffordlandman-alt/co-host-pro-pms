import { Router } from "express";
import { getFxBook, publicBook } from "../lib/fx";

const router = Router();

router.get("/fx", async (_req, res) => {
  res.json(publicBook(await getFxBook()));
});

export default router;
