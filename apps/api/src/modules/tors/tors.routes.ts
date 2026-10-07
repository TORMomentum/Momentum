import { Router, type Request, type Response } from "express";
import type { SearchConfig } from "../../core/config.js";
import { BadRequestError } from "../../core/errors.js";
import { parseDisposition } from "../../lib/content-disposition.js";
import { streamDocument } from "../../lib/stream-document.js";
import type { Storage } from "../../ports/storage.port.js";
import { parseSearchQuery } from "./tors.query.js";
import type { TorsService } from "./tors.service.js";
import type { Config } from "../../core/config.js";
import { UnauthorizedError } from "../../core/errors.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { MatchingRepository } from "../matching/matching.repository.js";
import { scoresForAccount } from "../matching/matching.scores.js";
import { ObjectId } from "mongodb";
import { matchPercent } from "@tor-radar/shared";

export interface TorsRouterDeps {
  service: TorsService;
  storage: Storage;
  search: SearchConfig;
  config: Config;
  profiles: ProfileRepository;
  matching: MatchingRepository;
}

/** Public TOR reads. Authentication middleware must not be mounted here. */
export function buildTorsRouter(deps: TorsRouterDeps): Router {
  const router = Router();

  // FR-E-3. A malformed parameter is a ZodError, which the error middleware
  // answers with 400 — never an operator reaching the database. Each row carries
  // its statistical-anomaly verdict (dashboard spec §6.2).
  router.get("/", async (req, res) => {
    const search = parseSearchQuery(req.query, deps.search);
    if (!search.filter.minMatch) {
      res.json(await deps.service.search(search));
      return;
    }
    // This remains a public route; only the optional vendor-match filter needs identity.
    if (!req.auth) throw new UnauthorizedError();
    const scores = await scoresForAccount(deps, req.auth.account._id.toString());
    const matchIds = Object.entries(scores)
      // Compared as the rounded percentage the badge shows: a TOR labelled
      // "70%" must not vanish under a 70% filter because it scored 0.695.
      .filter(([, score]) => matchPercent(score) >= search.filter.minMatch!)
      .map(([id]) => new ObjectId(id));
    res.json(await deps.service.search(search, matchIds));
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
