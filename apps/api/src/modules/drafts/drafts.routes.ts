import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import type { Config } from "../../core/config.js";
import { NotFoundError, UnauthorizedError } from "../../core/errors.js";
import { requireSameOrigin } from "../../core/require-same-origin.js";
import type { DraftsService } from "./drafts.service.js";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `POST /me/tors/:id/draft` (TOR-220): an AI draft of a cover letter for one TOR, from the signed-in vendor's own
 * profile and kept files. A POST because it spends a model call and changes nothing; the answer is never cached.
 * Off (404, as if the route did not exist) unless DRAFT_ENABLED, and limited per account, since each call costs.
 */
export function buildDraftsRouter(deps: { config: Config; service: DraftsService }): Router {
  const router = Router();
  const write = requireSameOrigin(deps.config.appOrigin);
  // Before the limiter, so a request that is refused anyway does not use up an account's allowance.
  const allowed: RequestHandler = (req, _res, next) => {
    if (!req.auth) throw new UnauthorizedError();
    if (!deps.config.draft.enabled || !OBJECT_ID.test(String(req.params.id))) throw new NotFoundError();
    next();
  };
  const limit = rateLimit({
    windowMs: 3_600_000,
    limit: deps.config.draft.ratePerHour,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.account._id.toString() ?? "anonymous",
    handler: (_req, res) => {
      res.status(429).json({ error: { code: "rate_limited", message: "ขอให้ AI ร่างบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" } });
    },
  });

  router.post("/me/tors/:id/draft", write, allowed, limit, async (req, res) => {
    const draft = await deps.service.draft(req.auth!.account._id.toString(), String(req.params.id));
    res.set("Cache-Control", "private, no-store").json(draft);
  });

  return router;
}
