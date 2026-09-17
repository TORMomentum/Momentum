export type NotEvaluatedReason =
  | "no-budget"
  | "unverified-budget"
  | "unverified-category"
  | "not-published"
  | "restricted"
  | "insufficient-peers"
  // The cohort's stored statistics lack what the active method needs — an
  // operational fault, not a property of the record. Reported rather than
  // swallowed, so a method switched before a recompute is visible instead of
  // quietly flagging nothing.
  | "stats-unavailable"
  | "no-spread";

interface EligibilityRecord {
  pipeline: { state: string };
  access: { restricted?: boolean };
  fields: {
    budget: { value: unknown; verified: boolean };
    category: { value: unknown; verified: boolean };
  };
}

interface BudgetBounds {
  budgetMinThb: number;
  budgetMaxThb: number;
}

export function eligibilityOf(record: EligibilityRecord, bounds: BudgetBounds): NotEvaluatedReason | null {
  const budget = record.fields.budget.value;
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget < bounds.budgetMinThb || budget > bounds.budgetMaxThb) {
    return "no-budget";
  }
  if (record.pipeline.state !== "published") return "not-published";
  // Fails closed: anything but an explicit false counts as restricted. A record
  // whose restriction state is unknown must not contribute to public figures,
  // and the database filter below can only be indexed as an equality — so the
  // two agree exactly, including on a record missing the field.
  if (record.access.restricted !== false) return "restricted";
  if (!record.fields.budget.verified) return "unverified-budget";
  if (typeof record.fields.category.value !== "string" || !record.fields.category.value || !record.fields.category.verified) {
    return "unverified-category";
  }
  return null;
}

/**
 * The same predicate as a Mongo filter, and the partial index's filter too.
 *
 * Every clause is index-legal on purpose: `partialFilterExpression` rejects
 * `$ne` outright (verified against the running server), and a query written
 * with `$ne: true` could not use an index built on `restricted: false` anyway,
 * because a document missing the field matches the query but is absent from the
 * index. Equality on both sides keeps one predicate, indexable, with no
 * silently-unindexed second copy.
 */
/**
 * An invitation to bid is a supporting document of a TOR (e-GP project linking
 * spec): its budget is the same project's budget, so counting it would count
 * the project twice. Kept out of every figure and peer group. Not part of
 * eligibleFilter(), because a partial index cannot express `$ne` — queries add
 * it, and the index still serves them, since they select a subset of it.
 */
export const NOT_SUPPORTING_DOCUMENT = { documentType: { $ne: "invitation" } } as const;

export function eligibleFilter() {
  return {
    "pipeline.state": "published",
    "access.restricted": false,
    "fields.budget.verified": true,
    "fields.category.verified": true,
    "fields.budget.value": { $type: "number", $gt: 0 },
  };
}
