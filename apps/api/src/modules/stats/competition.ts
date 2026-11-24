/**
 * TOR-280: how concentrated the announced winners are in each category.
 *
 * One row per awarded project (a project counts once however many TOR records it has), with the winner as the
 * announcement named it. The figures are counts and a share, nothing more: they say how the wins are spread,
 * never whether the spread is good or bad (NFR-F5). Bidders are out of scope (FR-B-2), so the number of bids a
 * project drew is not here.
 */
export interface AwardedProject {
  category: string;
  /** The award record the project's winner was read from: what makes a project count once. */
  awardId: string;
  winner: string;
}

export interface CategoryCompetition {
  category: string;
  /** Awarded projects with a named winner. */
  awarded: number;
  /** Different winners among them. */
  winners: number;
  /** Share of those projects won by the `topWinners` most frequent winners, 0 to 1. */
  topShare: number;
  /** False when `awarded` is below the sample the comparison needs: the row is listed but not ranked. */
  eligible: boolean;
}

/** The same name written with different spacing is one winner; the text itself is not changed. */
const winnerKey = (name: string) => name.replace(/\s+/g, " ").trim();

export function competitionByCategory(
  projects: AwardedProject[],
  settings: { topWinners: number; minAwarded: number },
): CategoryCompetition[] {
  const byCategory = new Map<string, Map<string, Set<string>>>();
  for (const { category, awardId, winner } of projects) {
    const key = winnerKey(winner);
    if (!category || !key) continue;
    const winners = byCategory.get(category) ?? new Map<string, Set<string>>();
    const awards = winners.get(key) ?? new Set<string>();
    awards.add(awardId);
    winners.set(key, awards);
    byCategory.set(category, winners);
  }
  return [...byCategory.entries()]
    .map(([category, winners]) => {
      const wins = [...winners.values()].map((awards) => awards.size).sort((left, right) => right - left);
      const awarded = wins.reduce((sum, count) => sum + count, 0);
      const top = wins.slice(0, settings.topWinners).reduce((sum, count) => sum + count, 0);
      return {
        category,
        awarded,
        winners: winners.size,
        topShare: awarded === 0 ? 0 : top / awarded,
        eligible: awarded >= settings.minAwarded,
      };
    })
    .sort((left, right) => left.category.localeCompare(right.category, "th"));
}
