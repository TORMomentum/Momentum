import { Router, type Request, type Response } from "express";
import { BadRequestError } from "../../core/errors.js";
import { parseDisposition } from "../../lib/content-disposition.js";
import { streamDocument } from "../../lib/stream-document.js";
import type { Storage } from "../../ports/storage.port.js";
import type { TorsService } from "./tors.service.js";
import { z } from "zod";
import { parseDashboardFilters, publicTorFilter } from "../stats/stats.filters.js";

export interface TorsRouterDeps {
  service: TorsService;
  storage: Storage;
}

/** Public TOR reads. Authentication middleware must not be mounted here. */
export function buildTorsRouter(deps: TorsRouterDeps): Router {
  const router = Router();

  const pageQuery = z.object({
    page: z.preprocess((value) => typeof value === "string" ? value : undefined, z.coerce.number().int().positive().optional()),
    pageSize: z.preprocess((value) => typeof value === "string" ? value : undefined, z.coerce.number().int().positive().max(200).optional()),
  }).strip();

  router.get("/", async (req, res) => {
    const pagination = pageQuery.safeParse(req.query);
    const { page = 1, pageSize = 25 } = pagination.success ? pagination.data : {};
    res.json(await deps.service.list(publicTorFilter(parseDashboardFilters(req.query)), page, pageSize));
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
  return router;
}
