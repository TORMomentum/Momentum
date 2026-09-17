import { Router } from "express";
import type { SearchConfig } from "../../core/config.js";
import { parseSearchQuery } from "./tors.query.js";
import type { TorsService } from "./tors.service.js";

export interface TorsRouterDeps {
  service: TorsService;
  search: SearchConfig;
}

/** Public TOR reads. Authentication middleware must not be mounted here. */
export function buildTorsRouter(deps: TorsRouterDeps): Router {
  const router = Router();

  // FR-E-3. A malformed parameter is a ZodError, which the error middleware
  // answers with 400 — never an operator reaching the database.
  router.get("/", async (req, res) => {
    res.json(await deps.service.search(parseSearchQuery(req.query, deps.search)));
  });

  // Declared before "/:id", which would otherwise claim it.
  router.get("/facets", async (_req, res) => {
    res.json(await deps.service.facets());
  });

  router.get("/:id", async (req, res) => {
    res.json(await deps.service.detail(req.params.id));
  });

  router.get("/:id/document", async (req, res) => {
    res.json(await deps.service.document(req.params.id));
  });

  return router;
}
