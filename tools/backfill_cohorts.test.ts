import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connect, disconnect, tors, torPeerStats, type TorDocument } from "../apps/api/src/core/db.js";
import { loadConfig } from "../apps/api/src/core/config.js";
import { isolatedDbUrl } from "../apps/api/src/test/mongo.js";
import "../apps/api/src/test/env.js";

const run = promisify(execFile);
const config = loadConfig(process.env);
const mongoUrl = isolatedDbUrl(config.mongoUrl, "backfill-cohorts");
let db: Awaited<ReturnType<typeof connect>>;

function record(category: string, announcedAt: Date | null, createdAt: Date): TorDocument {
  return {
    contentHash: `backfill-${category}-${createdAt.getTime()}`, storage: { bucket: "raw", key: "x", contentType: "application/pdf", bytes: 1 }, sourceRefs: [],
    pipeline: { state: "published", attempts: 1 }, fields: { category: { raw: category, value: category, confidence: 1, verified: true } }, announcedAt,
    sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt, updatedAt: createdAt,
  };
}

beforeAll(async () => { db = await connect(mongoUrl); });
beforeEach(async () => { await Promise.all([tors(db).deleteMany({}), torPeerStats(db).deleteMany({})]); });
afterAll(async () => { await disconnect(); });

describe("backfill cohorts tool", () => {
  it("derives both date sources, marks each derived cohort dirty, and is idempotent", async () => {
    await tors(db).insertMany([
      record("roads", new Date("2026-03-31T17:30:00Z"), new Date("2026-01-01T00:00:00Z")),
      record("health", null, new Date("2026-02-15T00:00:00Z")),
    ]);

    const first = await run(process.execPath, ["tools/backfill_cohorts.mjs"], { env: { ...process.env, MONGO_URL: mongoUrl } });
    const migrated = await tors(db).find({}, { sort: { "fields.category.value": 1 } }).toArray();

    expect(first.stdout).toContain("2 records updated");
    expect(migrated.map(({ cohort, cohortDateSource }) => ({ cohort, cohortDateSource }))).toEqual([
      { cohort: { category: "health", month: "2026-02" }, cohortDateSource: "intake" },
      { cohort: { category: "roads", month: "2026-04" }, cohortDateSource: "announced" },
    ]);
    expect(await torPeerStats(db).countDocuments({ dirty: true })).toBe(2);

    const second = await run(process.execPath, ["tools/backfill_cohorts.mjs"], { env: { ...process.env, MONGO_URL: mongoUrl } });
    expect(second.stdout).toContain("0 records updated");
  });
});
