import { Router, type Request } from "express";
import { z } from "zod";
import { requireKey } from "../intake/intake.auth.js";
import type { MatchQualityService } from "./match-quality.service.js";

const labelSchema = z.object({ label: z.enum(["relevant", "not-relevant", "unsure"]) }).strict();
const objectId = z.string().regex(/^[0-9a-f]{24}$/i);
const actorOf = (req: Request) => (req as Request & { actor?: string }).actor ?? "admin";

/** The match-quality benchmark (design §7.8). Staff only, behind the admin key like the rest of /admin. */
export function buildMatchQualityRouter(deps: { service: MatchQualityService; adminKeys: string[] }): Router {
  const router = Router();
  router.use(requireKey(deps.adminKeys, "admin"));

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
