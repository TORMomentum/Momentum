import { Router } from "express";
import { z } from "zod";
import { auditAdmin } from "../../core/security-log.js";
import { adminActor as actorOf, requireRole } from "../../core/require-role.js";
import type { MatchQualityService } from "./match-quality.service.js";

const labelSchema = z.object({ label: z.enum(["relevant", "not-relevant", "unsure"]) }).strict();
const objectId = z.string().regex(/^[0-9a-f]{24}$/i);

/** The match-quality benchmark (design §7.8). Staff only: an admin account, like the rest of /admin (TOR-199). */
export function buildMatchQualityRouter(deps: { service: MatchQualityService }): Router {
  const router = Router();
  router.use(requireRole("admin"));
  router.use(auditAdmin(actorOf));

  router.get("/match-quality", async (_req, res) => {
    res.json(await deps.service.figures());
  });

  router.get("/accounts/:id/labels", async (req, res) => {
    res.json(await deps.service.worksheet(objectId.parse(req.params.id)));
  });

  router.put("/accounts/:id/labels/:torId", async (req, res) => {
    const { label } = labelSchema.parse(req.body);
    await deps.service.label(objectId.parse(req.params.id), objectId.parse(req.params.torId), label, actorOf(req));
    res.json({ torId: req.params.torId, label });
  });

  return router;
}
