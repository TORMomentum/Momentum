import { ObjectId } from "mongodb";
import { MATCH_RANGE, matchPercent } from "@tor-radar/shared";
import { scoresForAccount, type MatchScoresDeps } from "../matching/matching.scores.js";

/**
 * The ids of the TORs whose personalised match falls in `[minMatch, maxMatch]`, for one vendor.
 * Shared by `GET /tors` and the CSV export, so the "match %" filter means the same in both.
 */
export async function matchIdsFor(
  deps: MatchScoresDeps,
  accountId: string,
  minMatch: number | undefined,
  maxMatch: number | undefined,
): Promise<ObjectId[]> {
  const scores = await scoresForAccount(deps, accountId);
  return (
    Object.entries(scores)
      // Compared as the rounded percentage the badge shows: a TOR labelled
      // "70%" must not vanish under a 70% filter because it scored 0.695.
      .filter(([, score]) => {
        const percent = matchPercent(score);
        return percent >= (minMatch ?? MATCH_RANGE.floor) && percent <= (maxMatch ?? MATCH_RANGE.ceiling);
      })
      .map(([id]) => new ObjectId(id))
  );
}
