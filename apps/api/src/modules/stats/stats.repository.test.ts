import "../../test/env.js";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { connect, disconnect, ensureIndexes, torPeerStats, torRollups, tors } from "../../core/db.js";
import { loadConfig } from "../../core/config.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { StatsRepository, windowKeysFor } from "./stats.repository.js";

const config = loadConfig(process.env);
const mongoUrl = isolatedDbUrl(config.mongoUrl, "stats-repository");
let db: Db;
let repository: StatsRepository;

beforeAll(async () => {
  db = await connect(mongoUrl);
  await ensureIndexes(db);
  repository = new StatsRepository(db);
});

beforeEach(async () => {
  await torPeerStats(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("windowKeysFor", () => {
  it("marks the cohort and every later window which contains it", () => {
    expect(windowKeysFor({ category: "roads", month: "2026-01" }, config.stats.peerWindowMonths)).toEqual([
      { category: "roads", month: "2026-01" },
      { category: "roads", month: "2026-02" },
      { category: "roads", month: "2026-03" },
      { category: "roads", month: "2026-04" },
      { category: "roads", month: "2026-05" },
      { category: "roads", month: "2026-06" },
      { category: "roads", month: "2026-07" },
      { category: "roads", month: "2026-08" },
      { category: "roads", month: "2026-09" },
      { category: "roads", month: "2026-10" },
      { category: "roads", month: "2026-11" },
      { category: "roads", month: "2026-12" },
    ]);
  });
});

describe("StatsRepository.markCohortsDirty", () => {
  it("upserts one exact document per window key, rather than one updateMany shape", async () => {
    const keys = windowKeysFor({ category: "roads", month: "2026-01" }, config.stats.peerWindowMonths);

    await repository.markCohortsDirty(keys);

    const docs = await torPeerStats(db).find({}, { sort: { month: 1 } }).toArray();
    expect(docs).toHaveLength(config.stats.peerWindowMonths);
    expect(docs.map((doc) => [doc.category, doc.month])).toEqual(keys.map((key) => [key.category, key.month]));
    expect(docs.every((doc) => doc.dirty && doc.generation === 1 && doc.dirtyAt instanceof Date)).toBe(true);
  });

  it("increments the generation when a cohort is marked again", async () => {
    await repository.markCohortsDirty([{ category: "roads", month: "2026-01" }]);
    await repository.markCohortsDirty([{ category: "roads", month: "2026-01" }]);

    expect(await torPeerStats(db).findOne({ category: "roads", month: "2026-01" })).toMatchObject({
      dirty: true,
      generation: 2,
    });
  });
});

function eligibleRecord(budget: number, month = "2026-01", over: Record<string, unknown> = {}) {
  const now = new Date("2026-01-15T00:00:00Z");
  return {
    contentHash: `stats-${budget}-${month}-${Math.random()}`,
    storage: { bucket: "raw", key: "x", contentType: "application/pdf", bytes: 1 }, sourceRefs: [],
    pipeline: { state: "published", attempts: 1 },
    fields: {
      budget: { raw: String(budget), value: budget, confidence: 1, verified: true },
      category: { raw: "roads", value: "roads", confidence: 1, verified: true },
      agency: { raw: "A", value: "A", confidence: 1, verified: true },
    }, announcedAt: now, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false },
    duplicateOf: null, createdAt: now, updatedAt: now, cohort: { category: "roads", month }, cohortDateSource: "announced",
    ...over,
  };
}

describe("StatsRepository recomputation", () => {
  beforeEach(async () => { await tors(db).deleteMany({}); });

  it("computes both methods' statistics from eligible records in the cohort window", async () => {
    for (const budget of [10, 20, 30, 40, 50, 60, 70, 80]) await tors(db).insertOne(eligibleRecord(budget) as never);
    await tors(db).insertOne(eligibleRecord(999, "2026-01", { fields: { budget: { value: 999, verified: false } } }) as never);
    await tors(db).insertOne(eligibleRecord(999, "2026-01", { access: { restricted: true } }) as never);

    expect(await repository.computeBounds({ category: "roads", month: "2026-01" }, config.stats)).toMatchObject({
      n: 8, q1: 27.5, q3: 62.5, iqr: 35, lowBound: -25, highBound: 115, mean: 45,
    });
  });

  it("does not clear a newer dirty generation after a mid-computation mark", async () => {
    const key = { category: "roads", month: "2026-01" };
    await repository.markCohortsDirty([key]);
    const claim = await repository.claimDirtyCohort(config.stats.leaseMs);
    expect(claim).toMatchObject({ generation: 1 });
    await repository.markCohortsDirty([key]);

    await repository.writeBounds(key, claim!.generation, { n: 0 }, config.stats);

    expect(await torPeerStats(db).findOne(key)).toMatchObject({ dirty: true, generation: 2 });
  });

  it("reclaims an expired lease but not a live one", async () => {
    const key = { category: "roads", month: "2026-01" };
    await torPeerStats(db).insertOne({ ...key, dirty: true, dirtyAt: new Date(), generation: 1, leaseUntil: new Date(Date.now() - config.stats.leaseMs) });
    expect(await repository.claimDirtyCohort(config.stats.leaseMs)).toMatchObject(key);
    expect(await repository.claimDirtyCohort(config.stats.leaseMs)).toBeNull();
  });

  it("recomputes to the same bounds when run twice over unchanged records", async () => {
    for (const budget of [10, 20, 30, 40, 50, 60, 70, 80]) await tors(db).insertOne(eligibleRecord(budget) as never);
    const key = { category: "roads", month: "2026-01" };

    const first = await repository.computeBounds(key, config.stats);
    await repository.writeBounds(key, 0, first, config.stats);
    const second = await repository.computeBounds(key, config.stats);

    // Idempotence matters because the sweep recomputes every cohort on a timer:
    // if a repeat changed the numbers, flags would flicker with no edit behind them.
    expect(second).toEqual(first);
  });

  it("counts the flagged records of a cohort into its rollup cell", async () => {
    for (const budget of [10, 20, 30, 40, 50, 60, 70, 80]) await tors(db).insertOne(eligibleRecord(budget) as never);
    await tors(db).insertOne(eligibleRecord(100_000) as never);
    const key = { category: "roads", month: "2026-01" };

    await repository.writeBounds(key, 0, await repository.computeBounds(key, config.stats), config.stats);
    await repository.recomputeRollups(["2026-01"], config);

    expect(await torRollups(db).findOne({ agency: "A", category: "roads", month: "2026-01" })).toMatchObject({
      torCount: 9,
      flaggedCount: 1,
    });
  });

  it("removes a rollup cell whose last record was taken down", async () => {
    await tors(db).insertOne(eligibleRecord(50) as never);
    await repository.recomputeRollups(["2026-01"], config);
    expect(await torRollups(db).countDocuments({ month: "2026-01" })).toBe(1);

    await tors(db).updateMany({}, { $set: { "access.restricted": true } });
    await repository.recomputeRollups(["2026-01"], config);

    // Upserting alone would leave the old total standing: the dashboard would
    // keep reporting spending for a record it is no longer allowed to show.
    expect(await torRollups(db).countDocuments({ month: "2026-01" })).toBe(0);
  });

  it("releases the lease even when a newer mark keeps the cohort dirty", async () => {
    const key = { category: "roads", month: "2026-01" };
    await repository.markCohortsDirty([key]);
    const claim = await repository.claimDirtyCohort(config.stats.leaseMs);
    await repository.markCohortsDirty([key]);

    await repository.writeBounds(key, claim!.generation, { n: 0 }, config.stats);

    // Still dirty, and claimable again immediately — holding the lease would
    // stall exactly the cohort that is known to need recomputing.
    expect(await repository.claimDirtyCohort(config.stats.leaseMs)).toMatchObject(key);
  });

  it("finds a cohort implied by records that has no bounds document yet", async () => {
    await tors(db).insertOne(eligibleRecord(50, "2026-03") as never);

    expect(await repository.distinctCohorts()).toEqual([{ category: "roads", month: "2026-03" }]);
  });
});
