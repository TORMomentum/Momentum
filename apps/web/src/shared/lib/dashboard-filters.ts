import { z } from "zod";

export interface DashboardFilters {
  agency?: string;
  category?: string;
  from?: string;
  to?: string;
  minBudget?: number;
  maxBudget?: number;
  status?: string;
}

const primitive = <T extends z.ZodType>(schema: T) => z.preprocess(
  (value) => {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first !== "string") return undefined;
    const parsed = schema.safeParse(first);
    return parsed.success ? parsed.data : undefined;
  },
  schema.optional(),
);

const text = primitive(z.string().trim().min(1).max(500).transform((value) => value.normalize("NFC")));
const month = primitive(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/));
const budget = primitive(z.coerce.number().finite().positive());

const dashboardFilterSchema = z.object({
  agency: text,
  category: text,
  from: month,
  to: month,
  minBudget: budget,
  maxBudget: budget,
  status: text,
}).strip();

/** Values cross a public URL boundary, so they are reduced to individual primitives first. */
export function parseDashboardFilters(searchParams: Record<string, unknown>): DashboardFilters {
  const parsed = dashboardFilterSchema.safeParse(searchParams);
  if (!parsed.success) return {};

  const filters = parsed.data;
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

/** Defaults are absent instead of encoded, keeping the public unfiltered URL canonical. */
export function serialiseDashboardFilters(filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}
