import { Router } from "express";
import { auditAdmin } from "../../core/security-log.js";
import { adminActor as actorOf, requireRole } from "../../core/require-role.js";
import type { SourceHealthService } from "./source-health.service.js";

/** Ingestion-source health (TOR-293). Staff only: an admin account, like the rest of /admin (TOR-199). */
export function buildSourcesRouter(deps: { service: SourceHealthService }): Router {
  const router = Router();
  router.use(requireRole("admin"));
  router.use(auditAdmin(actorOf));

  router.get("/sources", async (_req, res) => {
    res.json(await deps.service.overview());
  });

  return router;
}
