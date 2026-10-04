/**
 * The homepage's headline figures, taken from the same dashboard API the
 * dashboard reads, so the two pages can never disagree. Null when the API
 * could not be reached: the page then shows dashes, never invented numbers.
 */
export interface LandingFigures {
  torCount: number;
  budgetSum: number;
  agencyCount: number;
  /** Null until any TOR could be compared with its peer group. */
  anomalyCount: number | null;
  /** The last successful intake (FR-E-6). */
  lastIntakeAt: string | null;
}

const BANGKOK = "Asia/Bangkok";

/** "2569-09" — the Buddhist-era year and month of a moment, for the edition line. */
export function editionOf(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: BANGKOK, year: "numeric", month: "2-digit" })
    .format(date)
    .split("-");
  return `${Number(year) + 543}-${month}`;
}

/** A budget as a count-up value: billions above ฿1B, otherwise millions. */
export function budgetParts(baht: number): { value: number; decimals: number; suffix: string } {
  if (baht >= 1_000_000_000) return { value: baht / 1_000_000_000, decimals: 2, suffix: "B" };
  return { value: baht / 1_000_000, decimals: 1, suffix: "M" };
}
