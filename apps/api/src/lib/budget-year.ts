/**
 * Thailand's fiscal year (ปีงบประมาณ), derived rather than stored.
 *
 * It runs 1 October to 30 September, and is named for the Buddhist-era year it
 * ENDS in: 1 October 2025 CE begins ปีงบประมาณ 2569. Procurement is planned and
 * reported against it, so "which budget year is this TOR spending" is a
 * question a vendor asks and e-GP's own search offers.
 *
 * Derived from the announcement date, in Bangkok's calendar, because that date
 * is already recorded and already carries its own provenance. Storing a second
 * copy from the source system would be a second thing to keep in step, and the
 * derivation is exact: there is no judgement in it.
 */
export function budgetYearOf(announcedAt: Date | null, timeZone: string): number | null {
  if (!announcedAt || Number.isNaN(announcedAt.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })
    .format(announcedAt)
    .split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!year || !month) return null;

  // October onwards already belongs to the fiscal year that ends next calendar
  // year; +543 puts it in the Buddhist era the documents themselves use.
  return year + 543 + (month >= 10 ? 1 : 0);
}
