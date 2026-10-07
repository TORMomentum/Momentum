/**
 * The search "match at least N%" filter. Declared once so the API schema, the
 * URL parser and the slider cannot disagree about what a valid threshold is.
 *
 * `min` is the smallest threshold that filters anything: a slider resting at
 * `off` means "show everything" and is left out of the URL, as a budget handle
 * resting at the end of its range is. `step` is the slider's notch; a typed
 * value may be any whole percentage in range.
 */
export const MATCH_THRESHOLD = { off: 0, min: 1, max: 100, step: 5 } as const;

/** A score in [0, 1] as the whole percentage every badge shows. */
export function matchPercent(score: number): number {
  return Math.round(score * 100);
}
