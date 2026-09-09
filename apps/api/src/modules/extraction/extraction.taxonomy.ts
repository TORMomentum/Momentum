import seed from "./taxonomy.seed.json" with { type: "json" };

interface TaxonomyTag {
  id: string;
  th: string;
  aliases: string[];
}

const TAGS: TaxonomyTag[] = seed.tags;

/**
 * FR-B-4: map each extracted qualification string onto the shared skill taxonomy.
 * Substring match against a curated alias list - deterministic, explainable, and
 * cheap. Order of tags follows the seed; duplicates are removed. Returns an empty
 * array when nothing matches, which grading treats as "qualifications not usable".
 *
 * The seed is a pull-forward from F9 (Slice 4). When the editable taxonomy lands,
 * this function keeps its signature; only the source of `TAGS` changes.
 */
export function mapQualifications(qualifications: string[] | null): string[] {
  if (!qualifications || qualifications.length === 0) return [];
  const haystack = qualifications.join("\n");
  const matched = new Set<string>();
  for (const tag of TAGS) {
    if (tag.aliases.some((alias) => haystack.includes(alias))) matched.add(tag.id);
  }
  return [...matched];
}

/** The Thai label for a tag id, for display (NFR-F7). */
export function tagLabel(id: string): string {
  return TAGS.find((t) => t.id === id)?.th ?? id;
}
