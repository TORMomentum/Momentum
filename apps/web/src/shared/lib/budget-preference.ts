/**
 * The bounds of a vendor's stated budget interest.
 *
 * Deliberately NOT the corpus's own range. Search's slider is bounded by what
 * the collected TORs actually contain, because a filter that offers a range no
 * record falls into returns nothing and teaches the reader nothing. A profile
 * preference is the opposite: it says what this vendor wants to be matched
 * against, which has to stay true when tomorrow's corpus is larger or smaller
 * than today's. Bounding it by today's documents would silently rewrite a
 * vendor's stated interest every time the corpus moved.
 *
 * The ceiling is a practical limit for a single Thai procurement rather than a
 * measured one; it exists so the slider has a scale, and a vendor whose
 * interest runs past it is a signal to raise it here.
 */
export const BUDGET_PREFERENCE_MIN = 0;
export const BUDGET_PREFERENCE_MAX = 100_000_000;
export const BUDGET_PREFERENCE_STEP = 100_000;
