import { z } from "zod";
import type { Filter } from "mongodb";
import type { TorDocument } from "../../core/db.js";
import { NOT_SUPPORTING_DOCUMENT } from "./eligibility.js";
import { TOR_STATES, type TorState } from "../../lib/tor-state.js";

/**
 * "The ones we could not read a value for" is a real thing to ask a dashboard,
 * and it needs a value a query string can carry. A reserved sentinel says it
 * without pretending an empty string is an agency name.
 */
export const UNKNOWN = "__unknown__";

export interface DashboardFilters {
  agency?: string;
  category?: string;
  from?: string;
  to?: string;
  minBudget?: number;
  maxBudget?: number;
  status?: string;
  /**
   * The state a reader acts on, which is not the extracted status: it depends
   * on today's date as well as on the record. Applied in memory rather than as
   * a query, because the page already holds every matching record and a Mongo
   * predicate for "announced but past its deadline" would be a second
   * definition of a rule that must have exactly one.
   */
  state?: TorState;
  /** One month, or UNKNOWN for records whose month could not be derived. */
  month?: string;
}

const primitive = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(
  (value) => {
    if (typeof value !== "string") return undefined;
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  },
  schema.optional(),
);

const month = primitive(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/));
const text = primitive(z.string().trim().min(1).max(500));
const budget = primitive(z.coerce.number().finite().positive());
const state = primitive(z.enum(TOR_STATES as unknown as [TorState, ...TorState[]]));
const monthOrUnknown = primitive(z.string().regex(/^(\d{4}-(0[1-9]|1[0-2])|__unknown__)$/));

/** Query values are individual primitives before they become Mongo predicates. */
const schema = z.object({
  agency: text, category: text, from: month, to: month,
  minBudget: budget, maxBudget: budget, status: text, state, month: monthOrUnknown,
}).strip();

export function parseDashboardFilters(query: unknown): DashboardFilters {
  const parsed = schema.safeParse(query);
  if (!parsed.success) return {};
  const filters = parsed.data;
  // A reversed range is malformed input, not a request to invert a Mongo comparison.
  if (filters.from && filters.to && filters.from > filters.to) {
    delete filters.from;
    delete filters.to;
  }
  if (filters.minBudget && filters.maxBudget && filters.minBudget > filters.maxBudget) {
    delete filters.minBudget;
    delete filters.maxBudget;
  }
  return filters;
}

export function publicTorFilter(filters: DashboardFilters): Filter<TorDocument> {
  const filter: Record<string, unknown> = {
    "pipeline.state": "published", "access.restricted": false,
    "fields.budget.value": { $type: "number", $gt: 0 },
    ...NOT_SUPPORTING_DOCUMENT,
  };
  // An unreadable agency is stored as null or an empty string depending on how
  // the extraction failed, so the sentinel has to match both.
  if (filters.agency === UNKNOWN) filter["fields.agency.value"] = { $in: [null, ""] };
  else if (filters.agency) filter["fields.agency.value"] = filters.agency;
  if (filters.category) filter["cohort.category"] = filters.category;
  if (filters.month === UNKNOWN) filter["cohort.month"] = { $in: [null, ""] };
  else if (filters.month) filter["cohort.month"] = filters.month;
  else if (filters.from || filters.to) filter["cohort.month"] = { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) };
  if (filters.minBudget || filters.maxBudget) filter["fields.budget.value"] = { $type: "number", ...(filters.minBudget ? { $gte: filters.minBudget } : {}), ...(filters.maxBudget ? { $lte: filters.maxBudget } : {}) };
  if (filters.status) filter["fields.torStatus.value"] = filters.status;
  return filter as Filter<TorDocument>;
}
