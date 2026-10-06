import { Router } from "express";
import type { Config } from "../../core/config.js";
import type { Db, Filter } from "mongodb";
import type { TorRollupDocument } from "../../core/db.js";
import { redactTor } from "../../lib/redact.js";
import { StatsRepository } from "./stats.repository.js";
import { eligibilityOf } from "./eligibility.js";
import { verdictFor } from "./anomaly.rule.js";
import type { PeerBounds } from "./anomaly.rule.js";
import { parseDashboardFilters, publicTorFilter, type DashboardFilters } from "./stats.filters.js";

export interface StatsRouterDeps { db: Db; config: Config; }

function rollupFilter(filters: DashboardFilters): Filter<TorRollupDocument> {
  const filter: Record<string, unknown> = {};
  if (filters.agency) filter.agency = filters.agency;
  if (filters.category) filter.category = filters.category;
  if (filters.from || filters.to) filter.month = { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) };
  return filter as Filter<TorRollupDocument>;
}

const iso = (date: Date | undefined) => date?.toISOString() ?? null;

/** Public dashboard reads; all derived figures remain server-side. */
export function buildStatsRouter(deps: StatsRouterDeps): Router {
  const router = Router();
  const repository = new StatsRepository(deps.db);

  router.get("/dashboard", async (req, res) => {
    const filters = parseDashboardFilters(req.query);
    // Read the scope WITHOUT the agency filter once. The agency breakdown needs
    // that wider set anyway (see below), and deriving the narrower one in memory
    // keeps every figure on this page computed from a single snapshot — two
    // reads could straddle a write and disagree with each other.
    const agencyScope = { ...filters, agency: undefined };
    const [scopeRecords, meta] = await Promise.all([
      repository.dashboardRecords(publicTorFilter(agencyScope)),
      repository.dashboardMeta(),
    ]);
    const agencyOf = (record: (typeof scopeRecords)[number]) =>
      typeof record.fields.agency?.value === "string" ? record.fields.agency.value.trim() : "";
    const records = filters.agency ? scopeRecords.filter((record) => agencyOf(record) === filters.agency) : scopeRecords;
    const keys = records.flatMap((record) => record.cohort ? [record.cohort] : []);
    // One bounds read for all plotted rows avoids a per-row lookup whose cost
    // grows with the page rather than with the number of distinct peer groups.
    const bounds = await repository.boundsFor(keys);
    const boundsByKey = new Map(bounds.map((bound) => [`${bound.category}\u0000${bound.month}`, bound]));
    const points = records.flatMap((record) => {
      const budget = record.fields.budget?.value;
      if (!record.cohort || typeof budget !== "number") return [];
      const publicRecord = redactTor({ fields: record.fields }, "public");
      const reason = eligibilityOf(record as never, deps.config);
      const stored = boundsByKey.get(`${record.cohort.category}\u0000${record.cohort.month}`);
      const bound: PeerBounds | null = stored?.n === undefined ? null : stored as PeerBounds;
      const verdict = verdictFor(reason ? { budget, eligible: false, reason } : { budget, eligible: true }, bound, {
        method: deps.config.stats.method, minN: deps.config.stats.peerMinN,
        iqrMultiplier: deps.config.stats.iqrMultiplier, zScoreLimit: deps.config.stats.zScoreLimit,
      });
      return [{
        id: record._id.toString(), category: record.cohort.category, month: record.cohort.month, budget, verdict,
        confidence: publicRecord.fields.budget?.confidence ?? null,
        verified: publicRecord.fields.budget?.verified ?? false,
        modelVersion: record.provenance?.modelVersion ?? null,
      }];
    });
    const needsRecordTotals = filters.minBudget !== undefined || filters.maxBudget !== undefined || filters.status !== undefined;
    const asCells = (rows: typeof scopeRecords) => rows.map((record) => ({
      agency: agencyOf(record),
      month: record.cohort?.month ?? "", torCount: 1, budgetSum: record.fields.budget?.value as number,
      unverifiedBudgetCount: record.fields.budget?.verified ? 0 : 1, flaggedCount: 0,
    }));

    /**
     * The agency breakdown deliberately ignores the agency filter.
     *
     * It is what the screen's agency control is built from — a comparison and a
     * selector at once. Filtered by the agency already chosen it would collapse
     * to a single row: a one-bar chart that compares nothing, and a dropdown
     * whose only option is the one already picked, so a reader could never
     * switch from one agency to another without clearing the filter first.
     *
     * Every other filter still applies, so the comparison answers "within what
     * I am looking at, how do the agencies compare".
     */
    const breakdownSource = needsRecordTotals
      ? asCells(scopeRecords)
      : await repository.dashboardRollups(rollupFilter(agencyScope));
    const source = filters.agency
      ? breakdownSource.filter((cell) => cell.agency === filters.agency)
      : breakdownSource;
    const totals = source.reduce((sum, value) => ({
      torCount: sum.torCount + value.torCount, budgetSum: sum.budgetSum + value.budgetSum,
      unverifiedBudgetCount: sum.unverifiedBudgetCount + value.unverifiedBudgetCount,
    }), { torCount: 0, budgetSum: 0, unverifiedBudgetCount: 0 });
    const byAgency = new Map<string, { agency: string; torCount: number; budgetSum: number }>();
    const trend = new Map<string, { month: string; torCount: number; budgetSum: number }>();
    for (const value of breakdownSource) {
      const agency = byAgency.get(value.agency) ?? { agency: value.agency, torCount: 0, budgetSum: 0 };
      agency.torCount += value.torCount; agency.budgetSum += value.budgetSum; byAgency.set(value.agency, agency);
    }
    for (const value of source) {
      const month = trend.get(value.month) ?? { month: value.month, torCount: 0, budgetSum: 0 };
      month.torCount += value.torCount; month.budgetSum += value.budgetSum; trend.set(value.month, month);
    }
    // A chosen agency stays in the breakdown even when the other filters leave
    // it with nothing. Dropped, its bar and its dropdown entry would both
    // vanish while the filter stayed in the URL: the screen would look
    // unfiltered, show no results, and offer no way back out of the state.
    if (filters.agency && !byAgency.has(filters.agency)) {
      byAgency.set(filters.agency, { agency: filters.agency, torCount: 0, budgetSum: 0 });
    }
    // Counted from what the filters actually select, not from the breakdown:
    // "how many agencies am I looking at" is a different question from "which
    // agencies can I choose between".
    const agencyCount = new Set(source.map((value) => value.agency)).size;
    const evaluated = points.filter((point) => point.verdict.kind !== "not-evaluated");
    const flagged = evaluated.length === 0 ? null : points.filter((point) => point.verdict.kind === "anomaly").length;
    const corpusSize = meta?.corpusSize ?? await repository.corpusSize();
    res.json({
      totals: { ...totals, agencyCount }, flagged: { count: flagged },
      trend: [...trend.values()].sort((left, right) => left.month.localeCompare(right.month)),
      byAgency: [...byAgency.values()].sort((left, right) => left.agency.localeCompare(right.agency)), points,
      // The band the plot draws behind its points, one per peer group on the
      // screen. Sent with the points rather than fetched separately: a reader
      // must see the same bounds the verdict beside them was decided by.
      bounds: bounds.map((bound) => ({
        category: bound.category, month: bound.month, n: bound.n ?? 0,
        q1: bound.q1 ?? null, q3: bound.q3 ?? null,
        lowBound: bound.lowBound ?? null, highBound: bound.highBound ?? null,
        eligible: (bound.n ?? 0) >= deps.config.stats.peerMinN,
      })),
      // The active rule, so the methodology page states what actually ran
      // rather than a copy of it that can drift (FR-F-3).
      rule: {
        method: deps.config.stats.method,
        iqrMultiplier: deps.config.stats.iqrMultiplier,
        zScoreLimit: deps.config.stats.zScoreLimit,
        peerMinN: deps.config.stats.peerMinN,
        windowMonths: deps.config.stats.peerWindowMonths,
        cohortTimezone: deps.config.stats.timezone,
      },
      meta: { lastIntakeAt: iso(meta?.lastIntakeAt), statsComputedAt: iso(meta?.statsComputedAt), // Never computed counts as stale, not as fresh: figures nothing has ever
      // recalculated are exactly what the banner exists to disclose, and
      // reporting them as current would be the failure it guards against.
      stale: !meta?.statsComputedAt || Date.now() - meta.statsComputedAt.getTime() > deps.config.stats.staleAfterMs, corpusSize },
      checklist: null,
    });
  });
  return router;
}
