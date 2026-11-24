import "server-only";

import type { ChecklistSummary } from "@tor-radar/shared";
import type { DashboardFilters } from "../lib/dashboard-filters";
import { identityToken } from "./api-client";
import { forwardedClientHeaders } from "./client-ip";

export interface DashboardVerdict {
  kind: "anomaly" | "normal" | "not-evaluated";
  side?: "low" | "high";
  distance?: number | null;
  reason?: string;
  n?: number;
}

/** The five states a reader acts on; the API names them in lib/tor-state.ts. */
export type TorState = "open" | "awaiting-invitation" | "closed" | "awarded" | "cancelled";

export interface DashboardPayload {
  totals: { torCount: number; budgetSum: number; agencyCount: number; unverifiedBudgetCount: number };
  flagged: { count: number | null };
  trend: Array<{ month: string; torCount: number; budgetSum: number }>;
  byAgency: Array<{ agency: string; torCount: number; budgetSum: number }>;
  byState: Array<{ state: TorState; torCount: number; budgetSum: number }>;
  points: Array<{ id: string; category: string; month: string; budget: number; verdict: DashboardVerdict; confidence: number | null; verified: boolean; modelVersion: string | null }>;
  bounds: Array<{ category: string; month: string; n: number; q1: number | null; q3: number | null; lowBound: number | null; highBound: number | null; eligible: boolean }>;
  rule: { method: "IQR" | "ZSCORE"; iqrMultiplier: number; zScoreLimit: number; peerMinN: number; windowMonths: number; cohortTimezone: string };
  meta: { lastIntakeAt: string | null; statsComputedAt: string | null; stale: boolean; corpusSize: number };
  /** FR-F-4: failed checks over the plotted TORs; null from an API that predates the checklist. */
  checklist: ChecklistSummary | null;
}

/** TOR-280: how the announced winners are spread across categories. Counts of the collected corpus; no winner is named. */
export interface CompetitionPayload {
  categories: Array<{ category: string; awarded: number; winners: number; topShare: number; eligible: boolean }>;
  rule: { topWinners: number; minAwarded: number };
  meta: { awardedProjects: number; lastAwardAt: string | null };
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
  const base = apiBaseUrl();
  const response = await identityToken(base)
    .then(async (token) =>
      fetch(`${base}/api/v1/stats/dashboard${suffix}`, {
        cache: "no-store",
        headers: { ...(await forwardedClientHeaders()), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }),
    )
    .catch((error: unknown) => {
      throw new StatsApiUnavailable(String(error));
    });
  if (!response.ok) throw new StatsApiFailed(`GET /stats/dashboard → ${response.status}`);
  return response.json() as Promise<DashboardPayload>;
}

/** The winner spread by category. A failure here must not take the dashboard down, so the caller treats it as absent. */
export async function fetchCompetition(): Promise<CompetitionPayload> {
  const base = apiBaseUrl();
  const response = await identityToken(base)
    .then(async (token) =>
      fetch(`${base}/api/v1/stats/competition`, {
        cache: "no-store",
        headers: { ...(await forwardedClientHeaders()), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }),
    )
    .catch((error: unknown) => {
      throw new StatsApiUnavailable(String(error));
    });
  if (!response.ok) throw new StatsApiFailed(`GET /stats/competition → ${response.status}`);
  return response.json() as Promise<CompetitionPayload>;
}
