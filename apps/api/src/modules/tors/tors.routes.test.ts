import "../../test/env.js";

import { Readable } from "node:stream";
import express from "express";
import { ObjectId, type Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../core/config.js";
import { connect, disconnect, ensureIndexes, tors } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import type { Storage } from "../../ports/storage.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { TorsRepository } from "./tors.repository.js";
import { buildTorsRouter } from "./tors.routes.js";
import { TorsService } from "./tors.service.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { MatchingRepository } from "../matching/matching.repository.js";

const config = loadConfig(process.env);
const BYTES = Buffer.from("%PDF-1.7 public document body");
const recordStorage = {
  bucket: "tor-raw",
  key: "tors/2026/09/public-original.pdf",
  contentType: "application/pdf",
  bytes: BYTES.byteLength,
};

let db: Db;
let receivedAuthorization: string | undefined;
const getStream = vi.fn(async () => Readable.from([BYTES]));
const storage = {
  exists: vi.fn(async () => true),
  getStream,
} as unknown as Storage;

async function seedRecord(restricted = false): Promise<string> {
  const now = new Date();
  const result = await tors(db).insertOne({
    contentHash: `public-route-test-${restricted}`,
    storage: recordStorage,
    sourceRefs: [{ route: "upload", submittedBy: "admin", submittedAt: now }],
    pipeline: { state: "published", attempts: 1 },
    fields: {},
    announcedAt: null,
    sourceUrl: null,
    unverified: false,
    statusHistory: [],
    access: { restricted },
    duplicateOf: null,
    createdAt: now,
    updatedAt: now,
  });
  return result.insertedId.toString();
}

function buildTestApp(testConfig = config, trustProxy: number | string = 1) {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.use((req, _res, next) => {
    receivedAuthorization = req.get("authorization");
    next();
  });
  app.use(
    "/api/v1/tors",
    buildTorsRouter({
      service: new TorsService({ repo: new TorsRepository(db), config: testConfig }),
      storage,
      search: testConfig.search,
      config: testConfig,
      profiles: new ProfileRepository(db),
      matching: new MatchingRepository(db, testConfig),
    }),
  );
  app.use(errorMiddleware);
  return app;
}

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "tors-routes"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  await tors(db).deleteMany({});
  receivedAuthorization = undefined;
  getStream.mockClear();
});

afterAll(async () => {
  await disconnect();
});

describe("GET /tors/:id checklist C2 and C3 (TOR-200)", () => {
  const field = <T,>(value: T, verified = true) => ({ raw: String(value), value, confidence: 0.97, verified });
  async function seedWith(fields: Record<string, unknown>, announcedAt: Date | null): Promise<string> {
    const id = await seedRecord();
    await tors(db).updateOne({ _id: new ObjectId(id) }, { $set: { fields: fields as never, announcedAt } });
    return id;
  }
  const checksOf = async (id: string) =>
    Object.fromEntries(((await request(buildTestApp()).get(`/api/v1/tors/${id}`)).body.checklist.checks as { id: string; result: string; reason: string }[]).map((check) => [check.id, check]));

  it("evaluates the bid window and the scope from the stored record", async () => {
    const id = await seedWith({
      deadline: field("2026-03-19"),
      scopeSummary: field("จ้างก่อสร้างถนนคอนกรีตเสริมเหล็กพร้อมระบบระบายน้ำและงานทาสีตีเส้นจราจรตามแบบแปลนที่กำหนดไว้ในเอกสารแนบท้ายประกาศ".repeat(2)),
      scopeItems: field(16),
      scopeLocation: field("in_documents"),
    }, new Date("2026-03-05T00:00:00Z"));

    const checks = await checksOf(id);

    expect(checks.C2).toMatchObject({ result: "pass" });
    expect(checks.C2!.reason).toContain("14 วัน");
    expect(checks.C3).toMatchObject({ result: "pass" });
  });

  it("fails a window below the configured minimum and a scope below its minimums", async () => {
    const id = await seedWith({
      deadline: field("2026-03-09"),
      scopeSummary: field("สั้นมาก"),
      scopeItems: field(2),
      scopeLocation: field("in_documents"),
    }, new Date("2026-03-05T00:00:00Z"));

    const checks = await checksOf(id);

    expect(checks.C2).toMatchObject({ result: "fail" });
    expect(checks.C3).toMatchObject({ result: "fail" });
  });

  it("leaves both not evaluated, with the reason, for a record that states neither", async () => {
    const checks = await checksOf(await seedWith({}, null));

    expect(checks.C2).toMatchObject({ result: "not-evaluated" });
    expect(checks.C2!.reason).toContain("วันที่ประกาศ");
    expect(checks.C3).toMatchObject({ result: "not-evaluated" });
  });
});

describe("public TOR document route", () => {
  it("streams a published record's document with nosniff and no-store", async () => {
    const id = await seedRecord();

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document`);

    expect(response.status).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(getStream).toHaveBeenCalledWith(recordStorage.key, undefined);
  });

  it("returns 404 for a restricted record and never opens the object", async () => {
    const id = await seedRecord(true);

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document`);

    expect(response.status).toBe(404);
    expect(getStream).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown id", async () => {
    const response = await request(buildTestApp()).get(
      `/api/v1/tors/${new ObjectId().toString()}/document`,
    );

    expect(response.status).toBe(404);
    expect(getStream).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed id", async () => {
    const response = await request(buildTestApp()).get("/api/v1/tors/not-an-object-id/document");

    expect(response.status).toBe(404);
    expect(getStream).not.toHaveBeenCalled();
  });

  it("answers HEAD without opening the object", async () => {
    const id = await seedRecord();

    const response = await request(buildTestApp()).head(`/api/v1/tors/${id}/document`);

    expect(response.status).toBe(200);
    expect(getStream).not.toHaveBeenCalled();
  });

  it("rejects a disposition outside the allowlist", async () => {
    const id = await seedRecord();

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document?disposition=evil`);

    expect(response.status).toBe(400);
  });

  it("works without an Authorization header", async () => {
    const id = await seedRecord();

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document`);

    expect(receivedAuthorization).toBeUndefined();
    expect(response.status).toBe(200);
  });
});

describe("public TOR list route", () => {
  it("filters public records and gives each row its anomaly verdict from one cohort-bounds read", async () => {
    const now = new Date("2026-01-15T00:00:00Z");
    await tors(db).insertMany([
      {
        contentHash: "public-list-visible", storage: recordStorage, sourceRefs: [], pipeline: { state: "published", attempts: 1 },
        fields: {
          budget: { raw: "100", value: 100, confidence: 0.7, verified: true },
          category: { raw: "roads", value: "roads", confidence: 1, verified: true },
          agency: { raw: "A", value: "A", confidence: 1, verified: true },
        }, announcedAt: now, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null,
        createdAt: now, updatedAt: now, cohort: { category: "roads", month: "2026-01" }, cohortDateSource: "announced",
      },
      {
        contentHash: "public-list-hidden", storage: recordStorage, sourceRefs: [], pipeline: { state: "published", attempts: 1 }, fields: {}, announcedAt: now,
        sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: true }, duplicateOf: null, createdAt: now, updatedAt: now,
      },
    ] as never);

    // The search route (TOR-40/41) is the list: cursor-paged, with each row's verdict.
    const response = await request(buildTestApp()).get("/api/v1/tors?category=roads&pageSize=1");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, nextCursor: null });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ budget: { value: 100 }, verdict: { kind: "not-evaluated" } });
    expect(response.body.items[0]).not.toHaveProperty("cohort");
  });
});

describe("public read rate limits (TOR-318)", () => {
  const tiny = { ...config, publicSearchRateLimitPerMin: 2, documentRateLimitPerMin: 2 };

  it("answers 429 on search past the limit, per forwarded client address", async () => {
    const app = buildTestApp(tiny);
    const search = (ip: string) => request(app).get("/api/v1/tors").set("X-Forwarded-For", ip);

    expect((await search("203.0.113.1")).status).toBe(200);
    expect((await search("203.0.113.1")).status).toBe(200);
    expect((await search("203.0.113.1")).status).toBe(429);
    expect((await search("203.0.113.2")).status).toBe(200);
  });

  it("answers 429 on the document download past the limit, on a bucket separate from search", async () => {
    const id = await seedRecord();
    const app = buildTestApp(tiny);
    const download = () => request(app).get(`/api/v1/tors/${id}/document`).set("X-Forwarded-For", "203.0.113.1");

    expect((await download()).status).toBe(200);
    expect((await download()).status).toBe(200);
    expect((await download()).status).toBe(429);
    expect((await request(app).get("/api/v1/tors").set("X-Forwarded-For", "203.0.113.1")).status).toBe(200);
  });

  it("ignores X-Forwarded-For from a peer that is not a trusted proxy", async () => {
    // The test client connects from loopback; only 10.0.0.0/8 is trusted here.
    const app = buildTestApp(tiny, "10.0.0.0/8");
    const search = (ip: string) => request(app).get("/api/v1/tors").set("X-Forwarded-For", ip);

    expect((await search("203.0.113.1")).status).toBe(200);
    expect((await search("203.0.113.2")).status).toBe(200);
    expect((await search("203.0.113.3")).status).toBe(429);
  });
});
