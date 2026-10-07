import { Router } from "express";
import { z } from "zod";
import type { Config } from "../../core/config.js";
import { UnauthorizedError } from "../../core/errors.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { scoreMatch } from "./match-scorer.js";
import { MatchingRepository } from "./matching.repository.js";

const querySchema = z.object({ page: z.coerce.number().int().nonnegative().default(0) }).strict();

export function buildMatchingRouter(deps: { config: Config; profiles: ProfileRepository; matching: MatchingRepository }): Router {
  const router = Router();
  router.get("/me/matches", async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const profile = await deps.profiles.findByAccountId(req.auth.account._id.toString());
    if (!profile?.categories.length) {
      res.json({ items: [], reason: "กรุณาเลือกหมวดหมู่งานเพื่อดูรายการที่เกี่ยวข้อง" });
      return;
    }
    const { page } = querySchema.parse(req.query);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: deps.config.search.timeZone });
    const scored = (await deps.matching.candidatesFor(profile))
      .map(({ record, classification }) => ({
        id: record._id.toString(),
        title: record.fields.title?.raw ?? "",
        ...scoreMatch(profile, record, classification, deps.config, today),
      }))
      .filter((match) => match.excluded === null)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const start = page * deps.config.matching.pageSize;
    res.json({ items: scored.slice(start, start + deps.config.matching.pageSize), reason: null });
  });
  return router;
}
