import "../../test/env.js";

import { Readable } from "node:stream";
import express from "express";
import { ObjectId, type Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../core/config.js";
import {
  connect,
  corrections,
  disconnect,
  ensureIndexes,
  torEvents,
  tors,
} from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import type { Queue } from "../../ports/queue.port.js";
import type { Storage } from "../../ports/storage.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { HistoryRepository } from "../history/history.repository.js";
import { AdminRepository } from "./admin.repository.js";
import { buildAdminRouter } from "./admin.routes.js";
import { AdminService } from "./admin.service.js";

const config = loadConfig(process.env);
const adminKey = config.adminApiKeys[0]!;
const BYTES = Buffer.from("%PDF-1.7 private document body");
const recordStorage = {
  bucket: "tor-raw",
  key: "tors/2026/09/private-original.pdf",
  contentType: "application/pdf",
  bytes: BYTES.byteLength,
};

let db: Db;
const getStream = vi.fn(async () => Readable.from([BYTES]));

const storage = {
  exists: vi.fn(async () => true),
  getStream,
} as unknown as Storage;

const queue = {
  enqueue: vi.fn(async () => undefined),
} as unknown as Queue;

async function seedQueued(): Promise<string> {
  const now = new Date();
  const result = await tors(db).insertOne({
    contentHash: "route-test-hash",
    storage: recordStorage,
    sourceRefs: [{ route: "upload", submittedBy: "admin", submittedAt: now }],
    pipeline: { state: "published", attempts: 1 },
    fields: {
      title: { raw: "งานทดสอบ", value: "งานทดสอบ", confidence: 0.91, verified: false },
      agency: { raw: "หน่วยงานทดสอบ", value: "หน่วยงานทดสอบ", confidence: 0.88, verified: false },
      budget: { raw: "1000000", value: 1_000_000, confidence: 0.12, verified: false },
    },
    announcedAt: null,
    sourceUrl: null,
    confidenceLevel: "low",
    unverified: true,
    reviewReasons: ["budget-low-confidence"],
    statusHistory: [],
    access: { restricted: false },
    duplicateOf: null,
    createdAt: now,
    updatedAt: now,
  } as never);
  return result.insertedId.toString();
}

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/admin",
    buildAdminRouter({
      service: new AdminService({
        repo: new AdminRepository(db),
        history: new HistoryRepository(db),
        queue,
        tLow: config.tLow,
      }),
      storage,
      adminKeys: config.adminApiKeys,
      queuePageSize: config.adminQueuePageSize,
    }),
  );
  app.use(errorMiddleware);
  return app;
}

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "admin-routes"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  await Promise.all([
    tors(db).deleteMany({}),
    corrections(db).deleteMany({}),
    torEvents(db).deleteMany({}),
  ]);
  getStream.mockClear();
});

afterAll(async () => {
  await disconnect();
});

describe("admin document route", () => {
  it("streams a published record's document for staff, with nosniff and no-store", async () => {
    const id = await seedQueued();

    const response = await request(buildTestApp())
      .get(`/api/v1/admin/tors/${id}/document`)
      .set("authorization", `Bearer ${adminKey}`);

    expect(response.status).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(getStream).toHaveBeenCalledWith(recordStorage.key, undefined);
  });

  it("returns 404 for an unknown record", async () => {
    const response = await request(buildTestApp())
      .get(`/api/v1/admin/tors/${new ObjectId().toString()}/document`)
      .set("authorization", `Bearer ${adminKey}`);

    expect(response.status).toBe(404);
    expect(getStream).not.toHaveBeenCalled();
  });

  it("answers HEAD without opening the object", async () => {
    const id = await seedQueued();

    const response = await request(buildTestApp())
      .head(`/api/v1/admin/tors/${id}/document`)
      .set("authorization", `Bearer ${adminKey}`);

    expect(response.status).toBe(200);
    expect(getStream).not.toHaveBeenCalled();
  });

  it("requires the admin key", async () => {
    const id = await seedQueued();

    const response = await request(buildTestApp()).get(`/api/v1/admin/tors/${id}/document`);

    expect(response.status).toBe(401);
    expect(getStream).not.toHaveBeenCalled();
  });
});

describe("admin field verification route", () => {
  it("sets and clears verification without creating a correction or changing model confidence", async () => {
    const id = await seedQueued();
    const correctionsBefore = await corrections(db).countDocuments({ torId: id });
    const recordBefore = await tors(db).findOne({ _id: new ObjectId(id) });

    const confirmed = await request(buildTestApp())
      .patch(`/api/v1/admin/tors/${id}/fields/budget/verification`)
      .set("authorization", `Bearer ${adminKey}`)
      .send({ confirmed: true });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.fields.budget.verified).toBe(true);
    expect(await corrections(db).countDocuments({ torId: id })).toBe(correctionsBefore);

    const afterConfirmation = await tors(db).findOne({ _id: new ObjectId(id) });
    expect(afterConfirmation?.fields.budget?.confidence).toBe(
      recordBefore?.fields.budget?.confidence,
    );
    expect(afterConfirmation?.confidenceLevel).toBe(recordBefore?.confidenceLevel);

    const cleared = await request(buildTestApp())
      .patch(`/api/v1/admin/tors/${id}/fields/budget/verification`)
      .set("authorization", `Bearer ${adminKey}`)
      .send({ confirmed: false });

    expect(cleared.status).toBe(200);
    expect(cleared.body.fields.budget.verified).toBe(false);
    expect(await corrections(db).countDocuments({ torId: id })).toBe(correctionsBefore);

    const events = await torEvents(db).find({ torId: id }, { sort: { at: 1 } }).toArray();
    expect(events).toHaveLength(2);
    expect(events.map(({ actor, source, reason }) => ({ actor, source, reason }))).toEqual([
      { actor: "admin", source: "admin", reason: "field budget confirmed" },
      { actor: "admin", source: "admin", reason: "field budget confirmation cleared" },
    ]);

    const reloaded = await request(buildTestApp())
      .get(`/api/v1/admin/tors/${id}`)
      .set("authorization", `Bearer ${adminKey}`);
    expect(cleared.body).toEqual(reloaded.body);
  });

  it("rejects a field name outside the nine review fields", async () => {
    const id = await seedQueued();

    const response = await request(buildTestApp())
      .patch(`/api/v1/admin/tors/${id}/fields/procurementMethod/verification`)
      .set("authorization", `Bearer ${adminKey}`)
      .send({ confirmed: true });

    expect(response.status).toBe(400);
    expect(await torEvents(db).countDocuments({ torId: id })).toBe(0);
  });

  it("requires the admin key", async () => {
    const id = await seedQueued();

    const response = await request(buildTestApp())
      .patch(`/api/v1/admin/tors/${id}/fields/budget/verification`)
      .send({ confirmed: true });

    expect(response.status).toBe(401);
    const record = await tors(db).findOne({ _id: new ObjectId(id) });
    expect(record?.fields.budget?.verified).toBe(false);
  });
});
