import { NOT_A_CATEGORY, TAXONOMY_VERSION, WORK_CATEGORY_LEAVES } from "@tor-radar/seeds";
import { normalizeCategory, type TorCategory } from "@tor-radar/shared";
import type { Config } from "../../core/config.js";
import type { TorDocument } from "../../core/db.js";

/** Bump with a behaviour change even when the taxonomy itself did not change. */
export const CLASSIFIER_VERSION = "tor-classifier-2";
export const CURRENT_MAPPER_VERSION = `${CLASSIFIER_VERSION}+${TAXONOMY_VERSION}`;

export type TorClassification = {
  coarse: TorCategory | null;
  leaves: Array<{ id: string; score: number }>;
  /** Kept as an alias while existing stored documents age out. */
  nodes: Array<{ id: string; score: number }>;
  evidence: Array<{ field: string; text: string; nodeId: string }>;
  outcome: "classified" | "ambiguous" | "unknown" | "invalid-field-type";
  mapperVersion: string;
};

type ClassificationField = "title" | "scope" | "qualifications";

function isNotACategory(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalised = value.trim().toLocaleLowerCase("th-TH");
  return NOT_A_CATEGORY.some((item) => item.toLocaleLowerCase("th-TH") === normalised);
}

/**
 * Maps only text that says what work is being procured. The category is checked
 * for a deterministic field-type error but is never evidence by itself.
 */
export function classifyTor(record: Pick<TorDocument, "fields">, config: Config): TorClassification {
  const categoryValue = record.fields.category?.value;
  const invalidCategory = isNotACategory(typeof categoryValue === "string" ? categoryValue : null);
  const title = record.fields.title?.value ?? record.fields.title?.raw ?? "";
  const coarse = normalizeCategory(categoryValue, title);
  const fields: Array<{ field: ClassificationField; text: string; score: number }> = [
    { field: "title", text: title, score: config.matching.classifierTitleScore },
    { field: "scope", text: record.fields.scopeSummary?.value ?? record.fields.scopeSummary?.raw ?? "", score: config.matching.classifierScopeScore },
    {
      field: "qualifications",
      text: Array.isArray(record.fields.qualifications?.value) ? record.fields.qualifications.value.join("\n") : "",
      score: config.matching.classifierQualificationsScore,
    },
  ];
  const scores = new Map<string, number>();
  const evidence: TorClassification["evidence"] = [];

  for (const input of fields) {
    if (!input.text.trim()) continue;
    const haystack = input.text.toLocaleLowerCase("th-TH");
    for (const leaf of WORK_CATEGORY_LEAVES) {
      // A national category is authoritative coarse context. Fine text may add
      // multiple specialties, but must not contradict that procurement class.
      if (coarse && !leaf.torCategories.includes(coarse)) continue;
      const matched = [leaf.th, ...leaf.synonyms].some((label) => haystack.includes(label.toLocaleLowerCase("th-TH")));
      if (!matched) continue;
      scores.set(leaf.id, Math.max(scores.get(leaf.id) ?? 0, input.score));
      evidence.push({ field: input.field, text: input.text, nodeId: leaf.id });
    }
  }

  const leaves = [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const groupFor = new Map(WORK_CATEGORY_LEAVES.map((leaf) => [leaf.id, leaf.groupId]));
  const best = leaves.at(0);
  const ambiguous = Boolean(best && leaves.slice(1).some((node) =>
    groupFor.get(node.id) !== groupFor.get(best.id) && best.score - node.score <= config.matching.classifierAmbiguityMargin,
  ));

  return {
    coarse,
    leaves,
    nodes: leaves,
    evidence,
    outcome: invalidCategory ? "invalid-field-type" : !best ? "unknown" : ambiguous ? "ambiguous" : "classified",
    mapperVersion: CURRENT_MAPPER_VERSION,
  };
}
