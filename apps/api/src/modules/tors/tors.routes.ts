import { Router } from "express";
import type { TorsService } from "./tors.service.js";

export interface TorsRouterDeps {
  service: TorsService;
}

/** Public TOR reads. Authentication middleware must not be mounted here. */
export function buildTorsRouter(deps: TorsRouterDeps): Router {
  const router = Router();

  router.get("/:id/document", async (req, res) => {
    res.json(await deps.service.document(req.params.id));
  });

  return router;
}
