const thaiDigits = "๐๑๒๓๔๕๖๗๘๙";

/**
 * Converts a reviewer-entered budget into the numeric representation required
 * by aggregation and peer statistics. Thai numerals are normalised at this
 * boundary because reviewers should not have to switch keyboard layouts to
 * make a value usable by MongoDB arithmetic.
 */
export function parseBudget(value: string, maximum: number): number | null {
  const normalised = value.trim()
    .replace(/[๐-๙]/g, (digit) => String(thaiDigits.indexOf(digit)))
    .replaceAll(",", "");

  if (!/^\d+(?:\.\d+)?$/.test(normalised)) return null;

  const parsed = Number(normalised);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) return null;
  return parsed;
}
