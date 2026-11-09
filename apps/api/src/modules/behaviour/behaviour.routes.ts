import { Router } from "express";
import { z } from "zod";
import { authRateLimit } from "../../core/auth-rate-limit.js";
import type { Config } from "../../core/config.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../core/errors.js";
import { requireSameOrigin } from "../../core/require-same-origin.js";
import { TorsRepository } from "../tors/tors.repository.js";
import { BehaviourRepository } from "./behaviour.repository.js";

const eventSchema = z.object({
  torId: z.string().regex(/^[0-9a-f]{24}$/i),
  type: z.enum(["view", "save", "dismiss", "prepare"]),
}).strict();

export function buildBehaviourRouter(deps: { config: Config; behaviour: BehaviourRepository; tors: TorsRepository }): Router {
  const router = Router();
  const writes = [requireSameOrigin(deps.config.appOrigin), ...authRateLimit(deps.config)];

  /**
   * One thing the signed-in vendor did to a TOR. Refused outright without behaviour consent — the client is
   * meant to check first, but nothing is recorded because it forgot to.
   */
  router.post("/me/events", ...writes, async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const input = eventSchema.parse(req.body);
    const accountId = req.auth.account._id.toString();
    if (!(await deps.behaviour.hasConsent(accountId))) throw new ForbiddenError("ยังไม่ได้ยินยอมให้บันทึกพฤติกรรมการใช้งาน");
    if (!(await deps.tors.exists(input.torId))) throw new NotFoundError();
    await deps.behaviour.record(accountId, input.torId, input.type);
    res.status(204).end();
  });

  return router;
}
