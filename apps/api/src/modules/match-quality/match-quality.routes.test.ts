import "../../test/env.js";
import express from "express";
import { ObjectId, type Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { connect, disconnect, ensureIndexes, matchLabels, torClassifications, tors, vendorProfiles } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { MatchingRepository } from "../matching/matching.repository.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { MatchLabelsRepository } from "./match-labels.repository.js";
import { buildMatchQualityRouter } from "./match-quality.routes.js";
import { MatchQualityService } from "./match-quality.service.js";

const config = loadConfig(process.env);
const auth = { "x-api-key": config.adminApiKeys[0]! };
let db: Db;

function app() {
  const result = express();
  result.use(express.json());
  result.use("/api/v1/admin", buildMatchQualityRouter({
    service: new MatchQualityService({ config, profiles: new ProfileRepository(db), matching: new MatchingRepository(db, config), labels: new MatchLabelsRepository(db) }),
    adminKeys: config.adminApiKeys,
  }));
  result.use(errorMiddleware);
  return result;
}

async function seedTor(title: string, budget: number): Promise<string> {
  const field = <T>(value: T) => ({ raw: String(value), value, confidence: 1, verified: true });
  const inserted = await tors(db).insertOne({
    contentHash: new ObjectId().toHexString(), storage: { bucket: "test", key: title, contentType: "application/pdf", bytes: 1 }, sourceRefs: [],
    pipeline: { state: "published", attempts: 1 },
    fields: { title: field(title), category: field("งานก่อสร้าง-ทาง สะพาน"), budget: field(budget), deadline: field("2099-01-01"), torStatus: field("announced") },
    announcedAt: null, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date(),
  } as never);
  return inserted.insertedId.toString();
}

const vendor = new ObjectId().toString();

beforeAll(async () => { db = await connect(isolatedDbUrl(config.mongoUrl, "match-quality")); await ensureIndexes(db); });
beforeEach(async () => {
  await Promise.all([vendorProfiles(db).deleteMany({}), tors(db).deleteMany({}), torClassifications(db).deleteMany({}), matchLabels(db).deleteMany({})]);
  // A 90% email bar: in budget clears it, far over budget does not.
  await vendorProfiles(db).insertOne({
    accountId: vendor, categories: ["construction.road"], areas: ["thailand"], budget: { minThb: 100, maxThb: 200 },
    notify: { preset: "all", minMatch: 90, leadDays: 7, deadlineReminder: false, anomalyAlert: false }, taxonomyVersion: "test", updatedAt: new Date(),
  });
});
afterAll(async () => { await disconnect(); });

describe("match-quality benchmark", () => {
  it("lays out what email would send first, then what it would not, each with its score", async () => {
    const inBudget = await seedTor("ก่อสร้างถนนคอนกรีต", 150);
    const overBudget = await seedTor("ก่อสร้างถนนลาดยาง", 10_000);

    const response = await request(app()).get(`/api/v1/admin/accounts/${vendor}/labels`).set(auth);

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { torId: string; matched: boolean }) => [item.torId, item.matched])).toEqual([[inBudget, true], [overBudget, false]]);
    expect(response.body.items[0].label).toBeNull();
  });

  it("records a judgement with the score and match decision of the moment, and computes the figures from them", async () => {
    const inBudget = await seedTor("ก่อสร้างถนนคอนกรีต", 150);
    const overBudget = await seedTor("ก่อสร้างถนนลาดยาง", 10_000);

    // Email would have sent the first (right) and missed the second (also relevant).
    await request(app()).put(`/api/v1/admin/accounts/${vendor}/labels/${inBudget}`).set(auth).send({ label: "relevant" }).expect(200);
    await request(app()).put(`/api/v1/admin/accounts/${vendor}/labels/${overBudget}`).set(auth).send({ label: "relevant" }).expect(200);

    const stored = await matchLabels(db).findOne({ accountId: vendor, torId: inBudget });
    expect(stored).toMatchObject({ label: "relevant", matched: true, labelledBy: "admin" });
    expect(stored?.score).toBeGreaterThan(0.9);

    const figures = (await request(app()).get("/api/v1/admin/match-quality").set(auth)).body;
    expect(figures).toMatchObject({ labelled: 2, vendors: 1, precision: 1, precisionOf: 1, recall: 0.5, recallOf: 2, unsureRate: 0 });

    // Relabelling replaces, never adds.
    await request(app()).put(`/api/v1/admin/accounts/${vendor}/labels/${inBudget}`).set(auth).send({ label: "not-relevant" }).expect(200);
    expect(await matchLabels(db).countDocuments({ accountId: vendor })).toBe(2);
    expect((await request(app()).get("/api/v1/admin/match-quality").set(auth)).body.precision).toBe(0);
  });

  it("says there is nothing to judge yet rather than computing from no labels", async () => {
    expect((await request(app()).get("/api/v1/admin/match-quality").set(auth)).body).toMatchObject({ labelled: 0, precision: null, recall: null, unsureRate: null });
  });

  it("refuses a TOR outside the vendor's list, an unknown label, and a caller without the key", async () => {
    const elsewhere = new ObjectId().toString();
    expect((await request(app()).put(`/api/v1/admin/accounts/${vendor}/labels/${elsewhere}`).set(auth).send({ label: "relevant" })).status).toBe(400);
    const id = await seedTor("ก่อสร้างถนนคอนกรีต", 150);
    expect((await request(app()).put(`/api/v1/admin/accounts/${vendor}/labels/${id}`).set(auth).send({ label: "maybe" })).status).toBe(400);
    expect((await request(app()).get("/api/v1/admin/match-quality")).status).toBe(401);
    expect(await matchLabels(db).countDocuments()).toBe(0);
  });
});
