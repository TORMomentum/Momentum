import { Router, type Request, type Response } from "express";
import type { SearchConfig } from "../../core/config.js";
import { BadRequestError } from "../../core/errors.js";
import { parseDisposition } from "../../lib/content-disposition.js";
import { streamDocument } from "../../lib/stream-document.js";
import type { Storage } from "../../ports/storage.port.js";
import { parseSearchQuery } from "./tors.query.js";
import type { TorsService } from "./tors.service.js";

export interface TorsRouterDeps {
  service: TorsService;
  storage: Storage;
  search: SearchConfig;
}

/** Public TOR reads. Authentication middleware must not be mounted here. */
export function buildTorsRouter(deps: TorsRouterDeps): Router {
  const router = Router();

  // FR-E-3. A malformed parameter is a ZodError, which the error middleware
  // answers with 400 — never an operator reaching the database. Each row carries
  // its statistical-anomaly verdict (dashboard spec §6.2).
  router.get("/", async (req, res) => {
    res.json(await deps.service.search(parseSearchQuery(req.query, deps.search)));
  });

  // Declared before "/:id", which would otherwise claim it.
  router.get("/facets", async (_req, res) => {
    res.json(await deps.service.facets());
  });

  const document = async (req: Request<{ id: string }>, res: Response) => {
    const disposition = parseDisposition(req.query.disposition);
    if (!disposition) throw new BadRequestError("disposition must be inline or attachment");
    const doc = await deps.service.documentToStream(req.params.id);
    await streamDocument(req, res, deps.storage, doc, disposition);
  };

  // HEAD before GET: in Express 5 a GET route answers HEAD when no earlier HEAD
  // route matches, and the HEAD path must not open the object.
  router.head("/:id/document", document);
  router.get("/:id/document", document);

  router.get("/:id", async (req: Request<{ id: string }>, res) => {
    res.json(await deps.service.detail(req.params.id));
  });

  return router;
}
