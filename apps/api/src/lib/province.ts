import { PROVINCES } from "@tor-radar/seeds";

/** Names a document may write for a province other than the official one. */
const ALIASES: Array<[string, string]> = [
  ["กรุงเทพฯ", "bangkok"],
  ["กรุงเทพ", "bangkok"],
  ["กทม", "bangkok"],
  ["โคราช", "nakhon-ratchasima"],
];

/**
 * A name this short is a common substring of ordinary Thai words (เลย, ตาก,
 * น่าน), so it counts only when written as a province: after จ. or จังหวัด.
 */
const SHORT_NAME = 4;

/**
 * The provinces a work-location text names, as seed ids, in order of first
 * mention. Matches names, never guesses from an agency or a district: a text
 * that names no province gives an empty list and area matching stays silent.
 */
export function provincesIn(text: string): string[] {
  const hits: Array<{ at: number; id: string }> = [];
  const note = (at: number, id: string) => {
    if (at >= 0 && !hits.some((hit) => hit.id === id)) hits.push({ at, id });
  };
  for (const province of PROVINCES) {
    if (province.th.length > SHORT_NAME) note(text.indexOf(province.th), province.id);
    else {
      for (const prefix of ["จังหวัด", "จ.", "จ. "]) note(text.indexOf(prefix + province.th), province.id);
    }
  }
  for (const [alias, id] of ALIASES) note(text.indexOf(alias), id);
  return hits.sort((a, b) => a.at - b.at).map((hit) => hit.id);
}
