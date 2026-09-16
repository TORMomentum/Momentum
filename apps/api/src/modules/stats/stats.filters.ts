import { z } from "zod";
import type { Filter } from "mongodb";
import type { TorDocument } from "../../core/db.js";

export interface DashboardFilters {
  agency?: string;
  category?: string;
  from?: string;
  to?: string;
  minBudget?: number;
  maxBudget?: number;
  status?: string;
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

/** Query values are individual primitives before they become Mongo predicates. */
const schema = z.object({
  agency: text, category: text, from: month, to: month,
  minBudget: budget, maxBudget: budget, status: text,
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
  };
  if (filters.agency) filter["fields.agency.value"] = filters.agency;
  if (filters.category) filter["cohort.category"] = filters.category;
  if (filters.from || filters.to) filter["cohort.month"] = { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) };
  if (filters.minBudget || filters.maxBudget) filter["fields.budget.value"] = { $type: "number", ...(filters.minBudget ? { $gte: filters.minBudget } : {}), ...(filters.maxBudget ? { $lte: filters.maxBudget } : {}) };
  if (filters.status) filter["fields.torStatus.value"] = filters.status;
  return filter as Filter<TorDocument>;
}
