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
  it("derives every figure from the records, so a budget filter and a plain read agree", async () => {
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
      // FR-F-4: the one plotted TOR states no qualifications, and its ฿100 budget is below the range
      // the anomaly rule compares, so C1 and C4 fail and C5 cannot be evaluated.
      checklist: {
        tors: 1,
        byCheck: [
          { id: "C1", failed: 1, notEvaluated: 0 },
          { id: "C2", failed: 0, notEvaluated: 1 },
          { id: "C3", failed: 0, notEvaluated: 1 },
          { id: "C4", failed: 1, notEvaluated: 0 },
          { id: "C5", failed: 0, notEvaluated: 1 },
        ],
        flagged: [],
      },
    });
    expect(response.body.points).toHaveLength(1);
    expect(response.body.points[0]).toMatchObject({ category: "roads", month: "2026-01", budget: 100, verdict: { kind: "not-evaluated" }, confidence: 0.6, verified: true, modelVersion: null });
  });
});

describe("GET /api/v1/stats/dashboard checklist C2 and C3 (TOR-200)", () => {
  const field = (value: unknown) => ({ raw: String(value), value, confidence: 0.97, verified: true });

  it("evaluates the bid window and the scope of a plotted TOR and reports the minimums in force", async () => {
    const base = record();
    await tors(db).insertOne(record({
      announcedAt: new Date("2026-01-05T00:00:00Z"),
      fields: {
        ...base.fields,
        deadline: field("2026-01-09"),
        scopeSummary: field("สั้น"),
        scopeItems: field(2),
        scopeLocation: field("in_documents"),
      },
    }) as never);

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard");

    const byCheck = Object.fromEntries(response.body.checklist.byCheck.map((row: { id: string; failed: number; notEvaluated: number }) => [row.id, row]));
    // A 4-day window and a thin scope both fall under the minimums: C2 and C3 failed, and neither was left unevaluated.
    expect(byCheck.C2).toMatchObject({ failed: 1, notEvaluated: 0 });
    expect(byCheck.C3).toMatchObject({ failed: 1, notEvaluated: 0 });
    expect(response.body.rule.checklist).toEqual({ minBidWindowDays: 8, minScopeChars: 112, minScopeSections: 6 });
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
    await tors(db).insertMany([
      record({ fields: { ...record().fields, agency: { raw: "Agency A", value: "Agency A", confidence: 1, verified: true }, category: { raw: "roads", value: "roads", confidence: 1, verified: true }, budget: { raw: "100", value: 100, confidence: 1, verified: true } }, cohort: { category: "roads", month: "2026-01" } }),
      record({ fields: { ...record().fields, agency: { raw: "Agency C", value: "Agency C", confidence: 1, verified: true }, category: { raw: "roads", value: "roads", confidence: 1, verified: true }, budget: { raw: "500", value: 500, confidence: 1, verified: true } }, cohort: { category: "roads", month: "2026-01" } }),
      record({ fields: { ...record().fields, agency: { raw: "Agency B", value: "Agency B", confidence: 1, verified: true }, category: { raw: "cleaning", value: "cleaning", confidence: 1, verified: true }, budget: { raw: "900", value: 900, confidence: 1, verified: true } }, cohort: { category: "cleaning", month: "2026-01" } }),
    ] as never);

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard?agency=Agency%20A&category=roads");

    expect(response.body.byAgency.map((row: { agency: string }) => row.agency)).toEqual(["Agency A", "Agency C"]);
    expect(response.body.totals).toMatchObject({ torCount: 1, budgetSum: 100, agencyCount: 1 });
  });

  it("keeps a chosen agency listed even when the other filters leave it with nothing", async () => {
    // Otherwise its bar and its dropdown entry both disappear while the filter
    // stays in the URL: the screen looks unfiltered, shows no results, and
    // offers no way back out.
    await tors(db).insertOne(record({ fields: { ...record().fields, agency: { raw: "Agency B", value: "Agency B", confidence: 1, verified: true }, category: { raw: "cleaning", value: "cleaning", confidence: 1, verified: true }, budget: { raw: "900", value: 900, confidence: 1, verified: true } }, cohort: { category: "cleaning", month: "2026-01" } }) as never);

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard?agency=Agency%20A&category=cleaning");

    expect(response.body.byAgency).toEqual([
      { agency: "Agency A", torCount: 0, budgetSum: 0 },
      { agency: "Agency B", torCount: 1, budgetSum: 900 },
    ]);
    expect(response.body.totals).toMatchObject({ torCount: 0, agencyCount: 0 });
  });
});

describe("the state breakdown", () => {
  it("counts the five states a reader acts on, not the raw extracted status", async () => {
    const base = record().fields;
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const past = "2020-01-01";
    await tors(db).insertMany([
      // Open: announced, deadline still ahead.
      record({ fields: { ...base, deadline: { raw: future, value: future, confidence: 1, verified: true } } }),
      // Announced but its invitation to bid is not out, so there is no deadline
      // to act on — not the same thing as open.
      record({ fields: { ...base, deadline: { raw: "", value: null, confidence: 1, verified: true } } }),
      // Announced, but the deadline has passed: closed however it is labelled.
      record({ fields: { ...base, deadline: { raw: past, value: past, confidence: 1, verified: true } } }),
      record({ fields: { ...base, torStatus: { raw: "awarded", value: "awarded", confidence: 1, verified: true } } }),
      record({ fields: { ...base, torStatus: { raw: "cancelled", value: "cancelled", confidence: 1, verified: true } } }),
    ] as never);

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard");

    expect(response.status).toBe(200);
    const counts = Object.fromEntries(
      response.body.byState.map((row: { state: string; torCount: number }) => [row.state, row.torCount]),
    );
    expect(counts).toEqual({ open: 1, "awaiting-invitation": 1, closed: 1, awarded: 1, cancelled: 1 });
    // Every state carries its own budget, and together they account for the headline total.
    const summed = response.body.byState.reduce((total: number, row: { budgetSum: number }) => total + row.budgetSum, 0);
    expect(summed).toBe(response.body.totals.budgetSum);
  });
});

describe("filtering by state and month", () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  async function seedMixed() {
    const base = record().fields;
    await tors(db).insertMany([
      record({ fields: { ...base, deadline: { raw: future, value: future, confidence: 1, verified: true } } }),
      record({ fields: { ...base, torStatus: { raw: "cancelled", value: "cancelled", confidence: 1, verified: true } } }),
      record({ cohort: { category: "roads", month: "2026-02" }, fields: { ...base, deadline: { raw: future, value: future, confidence: 1, verified: true } } }),
      // No agency and no month: the rows a reader sees as "ไม่ระบุ".
      record({ cohort: undefined, fields: { ...base, agency: { raw: "", value: null, confidence: 0, verified: false } } }),
    ] as never);
  }

  it("narrows the figures to one state while still listing the others", async () => {
    await seedMixed();

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard?state=cancelled");

    expect(response.body.totals.torCount).toBe(1);
    // The control that set the filter must still offer the way out of it.
    const states = Object.fromEntries(response.body.byState.map((r: { state: string; torCount: number }) => [r.state, r.torCount]));
    expect(states.open).toBe(2);
    expect(states.cancelled).toBe(1);
  });

  it("narrows to one month while the trend still shows every month", async () => {
    await seedMixed();

    const response = await request(buildTestApp()).get("/api/v1/stats/dashboard?month=2026-02");

    expect(response.body.totals.torCount).toBe(1);
    expect(response.body.trend.map((r: { month: string }) => r.month).sort()).toEqual(["", "2026-01", "2026-02"]);
  });

  it("can select the records whose agency or month could not be read", async () => {
    await seedMixed();

    const byAgency = await request(buildTestApp()).get("/api/v1/stats/dashboard?agency=__unknown__");
    const byMonth = await request(buildTestApp()).get("/api/v1/stats/dashboard?month=__unknown__");

    expect(byAgency.body.totals.torCount).toBe(1);
    expect(byMonth.body.totals.torCount).toBe(1);
  });
});

describe("GET /api/v1/stats/competition (TOR-280)", () => {
  // The Settings the route reads: top 3 winners, and at least PEER_MIN_N (8) awarded projects to rank a category.
  const awardBlock = (awardId: string, winner: string) => ({
    recordId: awardId,
    winner: { raw: winner, value: winner, confidence: 0.97 }, winnerKind: "juristic",
    price: { raw: "100", value: 100, confidence: 0.97 }, announcedOn: "2026-01-20", unverified: false,
    provenance: { extractModel: "m", modelVersion: "m-1", extractedAt: new Date("2026-02-01T00:00:00Z") },
  });
  const awarded = (category: string, awardId: string, winner: string, over: Record<string, unknown> = {}) => record({
    fields: { ...record().fields, category: { raw: category, value: category, confidence: 1, verified: true } },
    cohort: { category, month: "2026-01" },
    award: awardBlock(awardId, winner),
    ...over,
  });

  it("counts awarded projects, distinct winners and the top winners' share, naming nobody", async () => {
    const names = ["A", "A", "A", "B", "B", "C", "D", "E"];
    await tors(db).insertMany(names.map((name, index) => awarded("ก่อสร้าง", `award-${index}`, `บริษัท ${name} จำกัด`)) as never);

    const response = await request(buildTestApp()).get("/api/v1/stats/competition");

    expect(response.status).toBe(200);
    // A wins 3, B 2, then one each: the top three hold 6 of 8.
    expect(response.body.categories).toEqual([{ category: "ก่อสร้าง", awarded: 8, winners: 5, topShare: 0.75, eligible: true }]);
    expect(response.body.rule).toEqual({ topWinners: 3, minAwarded: 8 });
    expect(response.body.meta).toEqual({ awardedProjects: 8, lastAwardAt: "2026-02-01T00:00:00.000Z" });
    expect(JSON.stringify(response.body)).not.toContain("บริษัท");
  });

  it("counts a project once when its award sits on several TOR records", async () => {
    await tors(db).insertMany([awarded("ก่อสร้าง", "same", "บริษัท A จำกัด"), awarded("ก่อสร้าง", "same", "บริษัท A จำกัด")] as never);

    const response = await request(buildTestApp()).get("/api/v1/stats/competition");

    expect(response.body.categories[0]).toMatchObject({ awarded: 1, winners: 1, eligible: false });
  });

  it("leaves out unconfirmed awards, restricted records, supporting documents and records with no award", async () => {
    await tors(db).insertMany([
      awarded("ก่อสร้าง", "ok", "บริษัท A จำกัด"),
      awarded("ก่อสร้าง", "unconfirmed", "บริษัท B จำกัด", { award: { ...awardBlock("unconfirmed", "บริษัท B จำกัด"), unverified: true } }),
      awarded("ก่อสร้าง", "restricted", "บริษัท C จำกัด", { access: { restricted: true } }),
      awarded("ก่อสร้าง", "invitation", "บริษัท D จำกัด", { documentType: "invitation" }),
      awarded("ก่อสร้าง", "no-winner", "ignored", { award: { ...awardBlock("no-winner", "ignored"), winner: { raw: "", value: null, confidence: 0 } } }),
      record(),
    ] as never);

    const response = await request(buildTestApp()).get("/api/v1/stats/competition");

    expect(response.body.categories).toEqual([{ category: "ก่อสร้าง", awarded: 1, winners: 1, topShare: 1, eligible: false }]);
    expect(response.body.meta.awardedProjects).toBe(1);
  });

  it("counts a project once in the header and no more than the table accounts for", async () => {
    await tors(db).insertMany([
      awarded("ก่อสร้าง", "p1", "บริษัท A จำกัด"),
      awarded("ยา", "p1", "บริษัท A จำกัด"),
      awarded("ก่อสร้าง", "p2", "   "),
    ] as never);

    const response = await request(buildTestApp()).get("/api/v1/stats/competition");
    const tableTotal = response.body.categories.reduce((sum: number, row: { awarded: number }) => sum + row.awarded, 0);

    // p1 sits in two categories (two rows in the table) but is one project; p2 has no usable winner.
    expect(response.body.meta.awardedProjects).toBe(1);
    expect(response.body.meta.awardedProjects).toBeLessThanOrEqual(tableTotal);
  });

  it("answers an empty 429 past the per-client limit, like search", async () => {
    const limited = loadConfig({ ...process.env, PUBLIC_SEARCH_RATE_LIMIT_PER_MIN: "2" });
    const app = express();
    app.use("/api/v1/stats", buildStatsRouter({ db, config: limited }));
    app.use(errorMiddleware);

    expect((await request(app).get("/api/v1/stats/competition")).status).toBe(200);
    expect((await request(app).get("/api/v1/stats/competition")).status).toBe(200);
    const third = await request(app).get("/api/v1/stats/competition");
    expect(third.status).toBe(429);
    expect(third.text).toBe("");
  });

  it("reports an empty corpus honestly", async () => {
    const response = await request(buildTestApp()).get("/api/v1/stats/competition");

    expect(response.body).toEqual({ categories: [], rule: { topWinners: 3, minAwarded: 8 }, meta: { awardedProjects: 0, lastAwardAt: null } });
  });
});
