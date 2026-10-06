import "../../test/env.js";

import express from "express";
import type { Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { connect, disconnect, ensureIndexes, torMeta, torPeerStats, torRollups, tors } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { buildStatsRouter } from "./stats.routes.js";

const config = loadConfig(process.env);
let db: Db;

function record(over: Record<string, unknown> = {}) {
  const now = new Date("2026-01-15T00:00:00Z");
  return {
    contentHash: `dashboard-${Math.random()}`,
    storage: { bucket: "raw", key: "x", contentType: "application/pdf", bytes: 1 }, sourceRefs: [],
    pipeline: { state: "published", attempts: 1 },
    fields: {
      agency: { raw: "Agency A", value: "Agency A", confidence: 1, verified: true },
      budget: { raw: "100", value: 100, confidence: 0.6, verified: true },
      category: { raw: "roads", value: "roads", confidence: 1, verified: true },
      torStatus: { raw: "announced", value: "announced", confidence: 1, verified: true },
    },
    announcedAt: now, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null,
    createdAt: now, updatedAt: now, cohort: { category: "roads", month: "2026-01" }, cohortDateSource: "announced",
    ...over,
  };
}

function buildTestApp() {
  const app = express();
  app.use("/api/v1/stats", buildStatsRouter({ db, config }));
  app.use(errorMiddleware);
  return app;
}

beforeAll(async () => { db = await connect(isolatedDbUrl(config.mongoUrl, "stats-routes")); await ensureIndexes(db); });
beforeEach(async () => {
  await Promise.all([tors(db).deleteMany({}), torRollups(db).deleteMany({}), torPeerStats(db).deleteMany({}), torMeta(db).deleteMany({})]);
});
afterAll(async () => { await disconnect(); });

describe("public dashboard route", () => {
  it("uses rollups for ordinary filters, but computes a budget filter from TORs", async () => {
    await tors(db).insertMany([record(), record({ fields: { ...record().fields, budget: { raw: "300", value: 300, confidence: 1, verified: false } } })] as never);
    await torRollups(db).insertOne({ agency: "Agency A", category: "roads", month: "2026-01", torCount: 2, budgetSum: 400, unverifiedBudgetCount: 1, flaggedCount: 0, computedAt: new Date() });

    const rollup = await request(buildTestApp()).get("/api/v1/stats/dashboard?agency=Agency%20A");
    const filtered = await request(buildTestApp()).get("/api/v1/stats/dashboard?agency=Agency%20A&minBudget=200");

    expect(rollup.status).toBe(200);
    expect(rollup.body.totals).toEqual({ torCount: 2, budgetSum: 400, agencyCount: 1, unverifiedBudgetCount: 1 });
    expect(filtered.status).toBe(200);
    expect(filtered.body.totals).toEqual({ torCount: 1, budgetSum: 300, agencyCount: 1, unverifiedBudgetCount: 1 });
  });

  it("returns the specified payload, excludes restricted records and invitations, and exposes stale statistics", async () => {
    // An invitation to bid carries its project's budget; plotting it would show one project twice.
    await tors(db).insertMany([record(), record({ access: { restricted: true } }), record({ documentType: "invitation" })] as never);
    await torRollups(db).insertOne({ agency: "Agency A", category: "roads", month: "2026-01", torCount: 1, budgetSum: 100, unverifiedBudgetCount: 0, flaggedCount: 0, computedAt: new Date() });
    const old = new Date(Date.now() - config.stats.staleAfterMs - 1);
    await torMeta(db).insertOne({ _id: "dashboard", lastIntakeAt: new Date("2026-01-01T00:00:00Z"), statsComputedAt: old, corpusSize: 2 });

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard?category=roads&from=2026-01&to=2026-01");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      totals: { torCount: 1, budgetSum: 100, agencyCount: 1, unverifiedBudgetCount: 0 },
      flagged: { count: null }, trend: [{ month: "2026-01", torCount: 1, budgetSum: 100 }],
      byAgency: [{ agency: "Agency A", torCount: 1, budgetSum: 100 }],
      meta: { lastIntakeAt: "2026-01-01T00:00:00.000Z", statsComputedAt: old.toISOString(), stale: true, corpusSize: 2 },
      checklist: null,
    });
    expect(response.body.points).toHaveLength(1);
    expect(response.body.points[0]).toMatchObject({ category: "roads", month: "2026-01", budget: 100, verdict: { kind: "not-evaluated" }, confidence: 0.6, verified: true, modelVersion: null });
  });
});

describe("GET /api/v1/stats/dashboard freshness", () => {
  it("reports statistics that have never run as stale, not as current", async () => {
    // The banner exists to disclose figures nobody has recalculated. A dashboard
    // whose worker has never run is the clearest case of that, and calling it
    // fresh would be the exact failure the banner guards against.
    await torMeta(db).deleteMany({});

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard");

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ statsComputedAt: null, stale: true });
  });
});

describe("the agency breakdown under an agency filter", () => {
  it("still lists every agency, so the control that sets the filter can also clear or change it", async () => {
    // Filtered by the agency already chosen, the breakdown would collapse to one
    // row: a one-bar chart comparing nothing, and a dropdown whose only option
    // is the agency already picked.
    await tors(db).insertMany([
      record(),
      record({ fields: { ...record().fields, agency: { raw: "Agency B", value: "Agency B", confidence: 1, verified: true } } }),
    ] as never);
    await torRollups(db).insertMany([
      { agency: "Agency A", category: "roads", month: "2026-01", torCount: 1, budgetSum: 100, unverifiedBudgetCount: 0, flaggedCount: 0, computedAt: new Date() },
      { agency: "Agency B", category: "roads", month: "2026-01", torCount: 1, budgetSum: 900, unverifiedBudgetCount: 0, flaggedCount: 0, computedAt: new Date() },
    ]);

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard?agency=Agency%20A");

    expect(response.status).toBe(200);
    expect(response.body.byAgency.map((row: { agency: string }) => row.agency)).toEqual(["Agency A", "Agency B"]);
    // The figures themselves still honour the filter, and so does the count of
    // agencies being looked at — a different question from which are on offer.
    expect(response.body.totals).toMatchObject({ torCount: 1, budgetSum: 100, agencyCount: 1 });
  });

  it("applies the other filters to the breakdown, so it compares within what is on screen", async () => {
    // Agency C shares the category, Agency B does not. Both halves matter: C
    // proves the agency filter is NOT applied to the breakdown, and B proves the
    // category filter still is. Without C this passes even if the agency filter
    // were left in place.
    await torRollups(db).insertMany([
      { agency: "Agency A", category: "roads", month: "2026-01", torCount: 1, budgetSum: 100, unverifiedBudgetCount: 0, flaggedCount: 0, computedAt: new Date() },
      { agency: "Agency C", category: "roads", month: "2026-01", torCount: 2, budgetSum: 500, unverifiedBudgetCount: 0, flaggedCount: 0, computedAt: new Date() },
      { agency: "Agency B", category: "cleaning", month: "2026-01", torCount: 1, budgetSum: 900, unverifiedBudgetCount: 0, flaggedCount: 0, computedAt: new Date() },
    ]);

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard?agency=Agency%20A&category=roads");

    expect(response.body.byAgency.map((row: { agency: string }) => row.agency)).toEqual(["Agency A", "Agency C"]);
    expect(response.body.totals).toMatchObject({ torCount: 1, budgetSum: 100, agencyCount: 1 });
  });

  it("keeps a chosen agency listed even when the other filters leave it with nothing", async () => {
    // Otherwise its bar and its dropdown entry both disappear while the filter
    // stays in the URL: the screen looks unfiltered, shows no results, and
    // offers no way back out.
    await torRollups(db).insertOne(
      { agency: "Agency B", category: "cleaning", month: "2026-01", torCount: 1, budgetSum: 900, unverifiedBudgetCount: 0, flaggedCount: 0, computedAt: new Date() },
    );

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard?agency=Agency%20A&category=cleaning");

    expect(response.body.byAgency).toEqual([
      { agency: "Agency A", torCount: 0, budgetSum: 0 },
      { agency: "Agency B", torCount: 1, budgetSum: 900 },
    ]);
    expect(response.body.totals).toMatchObject({ torCount: 0, agencyCount: 0 });
  });
});
