import type { Config } from "../../core/config.js";
import type { BehaviourRepository } from "../behaviour/behaviour.repository.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { scoreMatch } from "./match-scorer.js";
import { MatchingRepository } from "./matching.repository.js";

export interface MatchScoresDeps {
  config: Config;
  profiles: ProfileRepository;
  matching: MatchingRepository;
  /** When present, a consenting vendor's own activity adjusts the score (TOR-216). */
  behaviour?: BehaviourRepository;
}

/**
 * Computes the current vendor's eligible scores once for both the score badge
 * endpoint and filtered public search. Scores are deliberately not persisted:
 * the profile, classification cache, and today's deadline can all change.
 */
export async function scoresForAccount(deps: MatchScoresDeps, accountId: string): Promise<Record<string, number>> {
  const profile = await deps.profiles.findByAccountId(accountId);
  if (!profile) return {};

  const today = new Date().toLocaleDateString("en-CA", { timeZone: deps.config.search.timeZone });
  const scores: Record<string, number> = {};
  const affinity = await deps.behaviour?.affinity(accountId);
  for (const { record, classification } of await deps.matching.candidatesFor(profile)) {
    const scored = scoreMatch(profile, record, classification, deps.config, today, affinity);
    if (scored.excluded === null) scores[record._id.toString()] = scored.score;
  }
  return scores;
}
