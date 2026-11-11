import { CERTIFICATIONS, CGD_BRANCHES, PERSONAL_CERTIFICATION_IDS, WORK_CATEGORIES, WORK_CATEGORY_LEAVES } from "@tor-radar/seeds";
import type { FieldPath, PathRequirement } from "@tor-radar/shared";
import type { Config } from "../../core/config.js";
import type { VendorProfileDocument } from "../../core/db.js";
import { certificationsMentioned, qualificationText } from "../matching/certifications.js";
import { cgdBranchOf } from "../matching/registration.js";
import type { ClassifiedCandidate } from "../matching/matching.repository.js";

/** A group id covers every leaf in it, as it does on a profile; a leaf id covers itself; anything else is not a field. */
export function fieldOf(id: string): { id: string; th: string; leafIds: string[] } | null {
  const group = WORK_CATEGORIES.find((item) => item.id === id);
  if (group) return { id: group.id, th: group.th, leafIds: group.children.map((leaf) => leaf.id) };
  const leaf = WORK_CATEGORY_LEAVES.find((item) => item.id === id);
  return leaf ? { id: leaf.id, th: leaf.th, leafIds: [leaf.id] } : null;
}

const certificationName = new Map<string, string>(CERTIFICATIONS.map((item) => [item.id, item.th]));
const branchName = new Map<string, string>(CGD_BRANCHES.map((item) => [item.id, item.th]));
const PERSONAL = new Set<string>(PERSONAL_CERTIFICATION_IDS);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * What the TORs sampled in a field ask for, and whether this vendor holds it.
 *
 * A requirement counts from a field read at `tLow` or better, the same bar matching uses, so a doubtful reading
 * never makes a certificate look wanted. A TOR is counted once per requirement however many times it names it.
 * "Holds" follows the scorer: only a section the vendor has stated can say they lack something, and a licence to
 * practise counts whether it is listed with the company's certifications or on a person. A budget counts only when
 * it was verified and lies inside the plausible range, the bar the statistics use, so a misread figure cannot
 * become a typical one.
 */
export function analyseField(
  target: { id: string; th: string },
  sample: ClassifiedCandidate[],
  profile: VendorProfileDocument | null,
  config: Pick<Config, "tLow" | "budgetMinThb" | "budgetMaxThb"> & { matching: Pick<Config["matching"], "registrationMinBudgetThb"> },
): FieldPath {
  const sure = (field: { confidence: number } | undefined) => Boolean(field) && field!.confidence >= config.tLow;
  const asked = new Map<string, number>();
  const count = (key: string) => asked.set(key, (asked.get(key) ?? 0) + 1);
  const budgets: number[] = [];

  for (const { record, classification } of sample) {
    const wanted = new Set<string>();
    const documents = record.fields.requiredDocuments;
    if (sure(documents)) for (const document of documents!.value ?? []) if (document.certification) wanted.add(`certification:${document.certification}`);
    if (sure(record.fields.qualifications)) for (const id of certificationsMentioned(qualificationText(record))) wanted.add(`certification:${id}`);
    const budget = record.fields.budget;
    if (sure(budget) && budget!.verified && typeof budget!.value === "number" && Number.isFinite(budget!.value) && budget!.value >= config.budgetMinThb && budget!.value <= config.budgetMaxThb) {
      budgets.push(budget!.value);
      const branch = budget!.value >= config.matching.registrationMinBudgetThb ? cgdBranchOf(record, classification) : null;
      if (branch) wanted.add(`registration:${branch}`);
    }
    for (const key of wanted) count(key);
  }

  const certifications = profile?.certifications;
  const staff = profile?.personnel;
  const holds = (kind: PathRequirement["kind"], id: string): boolean | null => {
    if (kind === "registration") return certifications ? certifications.cgd.some((held) => held.branch === id) : null;
    if (PERSONAL.has(id)) {
      if (certifications?.tags.includes(id) || staff?.some((member) => member.certifications.includes(id))) return true;
      return certifications || staff ? false : null;
    }
    return certifications ? certifications.tags.includes(id) : null;
  };

  const requirements = [...asked.entries()]
    .map(([key, n]): PathRequirement => {
      const [kind, id] = key.split(":") as [PathRequirement["kind"], string];
      return { kind, id, th: (kind === "registration" ? branchName : certificationName).get(id) ?? id, asked: n, holds: holds(kind, id) };
    })
    .sort((a, b) => b.asked - a.asked || a.id.localeCompare(b.id));

  const values = (profile?.pastProjects ?? []).map((project) => project.valueThb).filter((value): value is number => typeof value === "number");
  return {
    target,
    sample: sample.length,
    requirements,
    budget: budgets.length ? { n: budgets.length, medianThb: median(budgets) } : null,
    yourLargestProjectThb: values.length ? Math.max(...values) : null,
  };
}
