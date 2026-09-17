import "server-only";

import type { DashboardFilters } from "../lib/dashboard-filters";

export interface DashboardVerdict {
  kind: "anomaly" | "normal" | "not-evaluated";
  side?: "low" | "high";
  distance?: number | null;
  reason?: string;
  n?: number;
}

export interface DashboardPayload {
  totals: { torCount: number; budgetSum: number; agencyCount: number; unverifiedBudgetCount: number };
  flagged: { count: number | null };
  trend: Array<{ month: string; torCount: number; budgetSum: number }>;
  byAgency: Array<{ agency: string; torCount: number; budgetSum: number }>;
  points: Array<{ id: string; category: string; month: string; budget: number; verdict: DashboardVerdict; confidence: number | null; verified: boolean; modelVersion: string | null }>;
  bounds: Array<{ category: string; month: string; n: number; q1: number | null; q3: number | null; lowBound: number | null; highBound: number | null; eligible: boolean }>;
  rule: { method: "IQR" | "ZSCORE"; iqrMultiplier: number; zScoreLimit: number; peerMinN: number; windowMonths: number; cohortTimezone: string };
  meta: { lastIntakeAt: string | null; statsComputedAt: string | null; stale: boolean; corpusSize: number };
  checklist: null;
}

export class StatsApiUnavailable extends Error {}
export class StatsApiFailed extends Error {}

function apiBaseUrl(): string {
  const value = process.env.API_BASE_URL;
  if (!value) throw new Error("API_BASE_URL is not configured");
  return value;
}

/** Public reads stay on the Next server, which keeps deployment topology out of browser code. */
export async function fetchDashboard(filters: DashboardFilters = {}): Promise<DashboardPayload> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value));
  const suffix = query.size ? `?${query}` : "";
  const response = await fetch(`${apiBaseUrl()}/api/v1/stats/dashboard${suffix}`, { cache: "no-store" }).catch((error: unknown) => {
    throw new StatsApiUnavailable(String(error));
  });
  if (!response.ok) throw new StatsApiFailed(`GET /stats/dashboard → ${response.status}`);
  return response.json() as Promise<DashboardPayload>;
}
