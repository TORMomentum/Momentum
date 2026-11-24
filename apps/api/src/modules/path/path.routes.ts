import { Router } from "express";
import { z } from "zod";
import type { Config } from "../../core/config.js";
import { BadRequestError, UnauthorizedError } from "../../core/errors.js";
import type { MatchingRepository } from "../matching/matching.repository.js";
import type { ProfileRepository } from "../profile/profile.repository.js";
import { analyseField, fieldOf, winnerSpreadOf } from "./path.analysis.js";
import { competitionByCategory } from "../stats/competition.js";
import type { StatsRepository } from "../stats/stats.repository.js";

const querySchema = z.object({ target: z.string().min(1).max(100) }).strict();

/**
 * The company path (TOR-224): pick a field of work, see what the TORs collected in it ask for and which of that
 * this vendor has not stated. Nothing is stored: the target lives in the page's URL, so there is no new personal
 * data to export or delete, and the vendor's profile is read, never changed.
 */
export function buildPathRouter(deps: { config: Config; profiles: ProfileRepository; matching: MatchingRepository; stats: Pick<StatsRepository, "awardedProjects"> }): Router {
  const router = Router();
  router.get("/me/path", async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const { target } = querySchema.parse(req.query);
    const field = fieldOf(target);
    if (!field) throw new BadRequestError("ไม่พบสาขางานที่เลือก");
    const [profile, sample, awarded] = await Promise.all([
      deps.profiles.findByAccountId(req.auth.account._id.toString()),
      deps.matching.fieldSample(field.leafIds),
      deps.stats.awardedProjects(field.torCategories),
    ]);
    // The same rule as the dashboard's panel (TOR-280), so a category reads the same wherever it is shown.
    const rule = { topWinners: deps.config.stats.competitionTopWinners, minAwarded: deps.config.stats.peerMinN };
    res.json({
      ...analyseField({ id: field.id, th: field.th }, sample, profile, deps.config),
      winnerSpread: {
        ...winnerSpreadOf(field.torCategories, competitionByCategory(awarded.projects, rule), rule),
        lastAwardAt: awarded.lastAwardAt?.toISOString() ?? null,
      },
    });
  });
  return router;
}
