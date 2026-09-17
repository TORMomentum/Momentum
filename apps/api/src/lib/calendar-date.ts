/** The calendar date in a time zone, as `YYYY-MM-DD`. */
export function calendarDate(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD; the locale is a format choice, not a language.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * A moment as the calendar date it falls on in `timeZone`, stored the way every
 * date-only value in a record is: UTC midnight of that date. e-GP publishes
 * "2026-08-25T17:00:00Z", which is 26 August in Bangkok.
 */
export function asCalendarDay(at: Date, timeZone: string): Date {
  return new Date(`${calendarDate(at, timeZone)}T00:00:00Z`);
}
