import { Router, type Request } from "express";
import { auditAdmin } from "../../core/security-log.js";
import { requireKey } from "../intake/intake.auth.js";
import type { SourceHealthService } from "./source-health.service.js";

const actorOf = (req: Request) => (req as Request & { actor?: string }).actor ?? "admin";

/** Ingestion-source health (TOR-293). Staff only, behind the admin key like the rest of /admin. */
export function buildSourcesRouter(deps: { service: SourceHealthService; adminKeys: string[] }): Router {
  const router = Router();
  router.use(requireKey(deps.adminKeys, "admin"));
  router.use(auditAdmin(actorOf));

  router.get("/sources", async (_req, res) => {
    res.json(await deps.service.overview());
  });

  return router;
}
