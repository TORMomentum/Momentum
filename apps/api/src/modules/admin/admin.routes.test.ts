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
        repo: new AdminRepository(db, config.budgetMaxThb),
        history: new HistoryRepository(db),
        queue,
        tLow: config.tLow,
        budgetMaxThb: config.budgetMaxThb,
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

/** A high-confidence TOR whose category and qualifications still await a person. */
async function seedFieldsToConfirm(over: Record<string, unknown> = {}): Promise<string> {
  const now = new Date();
  const result = await tors(db).insertOne({
    contentHash: `fields-${Math.random()}`,
    storage: recordStorage,
    sourceRefs: [{ route: "url", submittedBy: "national-egp-import", submittedAt: now }],
    pipeline: { state: "published", attempts: 1 },
    fields: {
      title: { raw: "ประกวดราคาซื้อวัสดุ", value: "ประกวดราคาซื้อวัสดุ", confidence: 1, verified: true },
      agency: { raw: "สำนักการแพทย์", value: "สำนักการแพทย์", confidence: 1, verified: true, origin: "source" },
      budget: { raw: "1771700", value: 1_771_700, confidence: 1, verified: true, origin: "source" },
      category: { raw: "ซื้อวัสดุ", value: "ซื้อวัสดุ", confidence: 0.9, verified: false },
      qualifications: { raw: "ผู้ผลิตหรือตัวแทนจำหน่าย", value: ["ผู้ผลิตหรือตัวแทนจำหน่าย"], confidence: 0.9, verified: false, tags: [] },
    },
    announcedAt: null,
    sourceUrl: null,
    confidenceLevel: "high",
    unverified: false,
    reviewReasons: [],
    statusHistory: [],
    access: { restricted: false },
    duplicateOf: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as never);
  return result.insertedId.toString();
}

describe("admin fields-to-confirm view", () => {
  it("lists settled TORs whose category or qualifications are unverified, apart from the confidence queue", async () => {
    const queued = await seedQueued();
    const toConfirm = await seedFieldsToConfirm();
    await seedFieldsToConfirm({ documentType: "invitation" });

    const fields = await request(buildTestApp()).get("/api/v1/admin/queue?view=fields").set("authorization", `Bearer ${adminKey}`);
    const confidence = await request(buildTestApp()).get("/api/v1/admin/queue").set("authorization", `Bearer ${adminKey}`);

    expect(fields.status).toBe(200);
    expect(fields.body.items.map((item: { id: string }) => item.id)).toEqual([toConfirm]);
    expect(fields.body.items[0].reviewReasons).toEqual(["category-unconfirmed", "qualifications-unconfirmed"]);
    expect(fields.body.fieldsToConfirm).toBe(1);
    expect(confidence.body.items.map((item: { id: string }) => item.id)).toEqual([queued]);
    expect(confidence.body.fieldsToConfirm).toBe(1);
  });

  it("accepts a category from the closed list and refuses one that is not on it", async () => {
    const id = await seedFieldsToConfirm();
    const patch = (value: string) =>
      request(buildTestApp())
        .patch(`/api/v1/admin/tors/${id}/fields`)
        .set("authorization", `Bearer ${adminKey}`)
        .send({ edits: [{ field: "category", value }] });

    expect((await patch("ซื้อยา")).status).toBe(400);
    const accepted = await patch("ซื้อครุภัณฑ์การแพทย์และวิทยาศาสตร์");
    expect(accepted.status).toBe(200);
    expect((await tors(db).findOne({ _id: new ObjectId(id) }))?.fields.category?.value).toBe("ซื้อครุภัณฑ์การแพทย์และวิทยาศาสตร์");
  });

  it("points the reviewer at the unverified category and qualifications of such a record", async () => {
    const id = await seedFieldsToConfirm();

    const response = await request(buildTestApp()).get(`/api/v1/admin/tors/${id}`).set("authorization", `Bearer ${adminKey}`);

    expect(response.status).toBe(200);
    expect(response.body.flaggedFields.sort()).toEqual(["category", "qualifications"]);
  });
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

describe("admin budget correction route", () => {
  it("rejects an unparseable budget without writing a correction", async () => {
    const id = await seedQueued();
    const before = await tors(db).findOne({ _id: new ObjectId(id) });

    const response = await request(buildTestApp())
      .patch(`/api/v1/admin/tors/${id}/fields`)
      .set("authorization", `Bearer ${adminKey}`)
      .send({ edits: [{ field: "budget", value: "ไม่ระบุ" }] });

    expect(response.status).toBe(400);
    expect(await corrections(db).countDocuments({ torId: id })).toBe(0);
    expect(await tors(db).findOne({ _id: new ObjectId(id) })).toMatchObject({
      fields: { budget: before?.fields.budget },
    });
  });

  it("stores a corrected budget as a number", async () => {
    const id = await seedQueued();

    const response = await request(buildTestApp())
      .patch(`/api/v1/admin/tors/${id}/fields`)
      .set("authorization", `Bearer ${adminKey}`)
      .send({ edits: [{ field: "budget", value: "1,200,000" }] });

    expect(response.status).toBe(200);
    const stored = await tors(db).findOne({ _id: new ObjectId(id) });
    expect(stored?.fields.budget?.value).toBe(1_200_000);
    expect(typeof stored?.fields.budget?.value).toBe("number");
  });
});

describe("admin all-TORs list", () => {
  const list = (query: string) => request(buildTestApp()).get(`/api/v1/admin/tors${query}`).set("Authorization", `Bearer ${adminKey}`);

  it("lists every record, published or taken down, newest first, invitations only when asked", async () => {
    const queued = await seedQueued();
    const settled = await seedFieldsToConfirm({ createdAt: new Date(Date.now() + 1000) });
    const takenDown = await seedFieldsToConfirm({ access: { restricted: true, reason: "ไม่ใช่ TOR" }, createdAt: new Date(Date.now() + 2000) });
    await seedFieldsToConfirm({ documentType: "invitation" });

    const all = await list("");
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.rows.map((row: { id: string }) => row.id)).toEqual([takenDown, settled, queued]);
    expect(all.body.rows[0]).toMatchObject({ restricted: true, documentType: "tor", state: "published" });

    expect((await list("?status=restricted")).body.rows.map((row: { id: string }) => row.id)).toEqual([takenDown]);
    expect((await list("?kind=invitation")).body.total).toBe(1);
  });

  it("searches title and agency as literal text, so a regex character matches itself", async () => {
    await seedQueued();
    await seedFieldsToConfirm();

    expect((await list(`?q=${encodeURIComponent("สำนักการแพทย์")}`)).body.total).toBe(1);
    expect((await list(`?q=${encodeURIComponent(".*")}`)).body.total).toBe(0);
  });

  it("refuses an unknown status, and requires the admin key", async () => {
    expect((await list("?status=everything")).status).toBe(400);
    expect((await request(buildTestApp()).get("/api/v1/admin/tors")).status).toBe(401);
  });
});

describe("admin takedown and restore", () => {
  it("restores a taken-down TOR to the public, logging both, and keeps the original", async () => {
    const id = await seedFieldsToConfirm();
    const app = buildTestApp();
    const auth = { Authorization: `Bearer ${adminKey}` };

    await request(app).post(`/api/v1/admin/tors/${id}/reject`).set(auth).send({ reason: "ไม่ใช่เอกสาร TOR" }).expect(200);
    expect((await request(app).get(`/api/v1/admin/tors/${id}`).set(auth)).body).toMatchObject({ restricted: true, restrictedReason: "ไม่ใช่เอกสาร TOR" });

    const restored = await request(app).post(`/api/v1/admin/tors/${id}/restore`).set(auth);
    expect(restored.status).toBe(200);
    const record = await tors(db).findOne({ _id: new ObjectId(id) });
    expect(record?.access).toEqual({ restricted: false });
    expect(record?.storage.key).toBe(recordStorage.key);
    expect((await torEvents(db).find({ torId: id }).sort({ at: 1, _id: 1 }).toArray()).map((event) => event.to)).toEqual(["restricted", "published"]);
  });

  it("answers 404 for an unknown record", async () => {
    const response = await request(buildTestApp())
      .post(`/api/v1/admin/tors/${new ObjectId().toString()}/restore`)
      .set("Authorization", `Bearer ${adminKey}`);
    expect(response.status).toBe(404);
  });
});
