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
  if (record.access.restricted === true) return "restricted";
  if (!record.fields.budget.verified) return "unverified-budget";
  if (typeof record.fields.category.value !== "string" || !record.fields.category.value || !record.fields.category.verified) {
    return "unverified-category";
  }
  return null;
}

export function eligibleFilter() {
  return {
    "pipeline.state": "published",
    "access.restricted": { $ne: true },
    "fields.budget.verified": true,
    "fields.category.verified": true,
    "fields.budget.value": { $type: "number", $gt: 0 },
  };
}
