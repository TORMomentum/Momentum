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

function buildTestApp() {
  const app = express();
  app.use((req, _res, next) => {
    receivedAuthorization = req.get("authorization");
    next();
  });
  app.use(
    "/api/v1/tors",
    buildTorsRouter({
      service: new TorsService({ repo: new TorsRepository(db), config }),
      storage,
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
  it("filters public records and maps the page through one cohort-bounds read", async () => {
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

    const response = await request(buildTestApp()).get("/api/v1/tors?category=roads&page=1&pageSize=1");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ fields: { budget: { value: 100 } }, verdict: { kind: "not-evaluated" } });
  });
});
