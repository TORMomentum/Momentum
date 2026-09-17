/**
 * A record's peer group, as a key it carries rather than a query it implies.
 *
 * The anomaly rule compares a budget against comparable TORs — same category,
 * same twelve-month window (SRS §4.5.1). Anchoring that window to "now" would
 * change an old record's peers every day and make its bounds impossible to
 * cache, so the key is the record's own month and the window ends there.
 *
 * The month comes from the announcement date when there is one. On the labelled
 * corpus nine of ten documents have none (docs/corpus/BENCHMARK.md), so intake
 * time is the fallback — recorded in `cohortDateSource`, and stated on the
 * methodology page. Passing an intake date off as an announcement date silently
 * would misrepresent when the spending happened.
 */
export interface CohortKey {
  category: string;
  month: string;
}

export interface CohortInput {
  category: string;
  announcedAt: Date | null;
  createdAt: Date;
}

export function monthKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(date).slice(0, 7);
}

export function cohortFor(input: CohortInput, timeZone: string): { cohort: CohortKey; cohortDateSource: "announced" | "intake" } | null {
  if (!input.category) return null;

  // Bangkok announcements late in the evening otherwise become the prior UTC month.
  const announcedAt = input.announcedAt && !Number.isNaN(input.announcedAt.getTime()) ? input.announcedAt : null;
  const date = announcedAt ?? input.createdAt;

  return {
    cohort: { category: input.category, month: monthKey(date, timeZone) },
    cohortDateSource: announcedAt ? "announced" : "intake",
  };
}
