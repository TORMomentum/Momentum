import { Router, type Request, type Response } from "express";
import { BadRequestError } from "../../core/errors.js";
import { parseDisposition } from "../../lib/content-disposition.js";
import { streamDocument } from "../../lib/stream-document.js";
import type { Storage } from "../../ports/storage.port.js";
import type { TorsService } from "./tors.service.js";

export interface TorsRouterDeps {
  service: TorsService;
  storage: Storage;
}

/** Public TOR reads. Authentication middleware must not be mounted here. */
export function buildTorsRouter(deps: TorsRouterDeps): Router {
  const router = Router();

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
