import { Router } from "express";
import type { Db } from "../db/pool.js";

/** Liveness + database check for Render. Reveals nothing beyond up/down. */
export function healthRouter(db: Db): Router {
  const router = Router();
  router.get("/healthz", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      await Promise.race([
        db.query("SELECT 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000).unref()),
      ]);
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  return router;
}
