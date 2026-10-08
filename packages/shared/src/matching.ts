/**
 * The search "match between N% and M%" filter. Declared once so the API schema,
 * the URL parser and the slider cannot disagree about what a valid bound is.
 *
 * A handle resting at `floor` or `ceiling` is no bound at all and is left out
 * of the URL, as a budget handle resting at the end of its range is. `step` is
 * the slider's notch; a typed value may be any whole percentage in range.
 */
export const MATCH_RANGE = { floor: 0, ceiling: 100, step: 5 } as const;

/** A score in [0, 1] as the whole percentage every badge shows. */
export function matchPercent(score: number): number {
  return Math.round(score * 100);
}

/**
 * The email setting "only matches scoring at least N%". Read by the API's
 * profile schema, the default profile and the slider, so the three agree.
 */
export const NOTIFY_MIN_MATCH = { floor: 50, ceiling: 95, step: 5 } as const;
