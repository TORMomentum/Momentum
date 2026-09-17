import "../../test/env.js";

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
const signedUrl = "https://objects.example.test/public-document";
const recordStorage = {
  bucket: "tor-raw",
  key: "tors/2026/09/public-original.pdf",
  contentType: "application/pdf",
  bytes: 184_320,
};

let db: Db;
let receivedAuthorization: string | undefined;
const signDocument = vi.fn(async (_key: string, _ttlSeconds: number) => signedUrl);
const storage = { signedUrl: signDocument } as unknown as Storage;

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
      service: new TorsService({
        repo: new TorsRepository(db),
        storage,
        signedUrlTtlSeconds: config.signedUrlTtlSeconds,
        facetLimit: config.search.facetLimit,
        timeZone: config.search.timeZone,
      }),
      search: config.search,
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
  signDocument.mockClear();
});

afterAll(async () => {
  await disconnect();
});

describe("public TOR document route", () => {
  it("returns a signed URL for a normal record", async () => {
    const id = await seedRecord();

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      url: signedUrl,
      expiresInSeconds: config.signedUrlTtlSeconds,
      contentType: recordStorage.contentType,
      bytes: recordStorage.bytes,
    });
    expect(signDocument).toHaveBeenCalledExactlyOnceWith(
      recordStorage.key,
      config.signedUrlTtlSeconds,
    );
  });

  it("returns 404 without a URL for a restricted record", async () => {
    const id = await seedRecord(true);

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document`);

    expect(response.status).toBe(404);
    expect(response.body).not.toHaveProperty("url");
    expect(signDocument).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown id", async () => {
    const response = await request(buildTestApp()).get(
      `/api/v1/tors/${new ObjectId().toString()}/document`,
    );

    expect(response.status).toBe(404);
    expect(signDocument).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed id", async () => {
    const response = await request(buildTestApp()).get("/api/v1/tors/not-an-object-id/document");

    expect(response.status).toBe(404);
    expect(signDocument).not.toHaveBeenCalled();
  });

  it("works without an Authorization header", async () => {
    const id = await seedRecord();

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document`);

    expect(receivedAuthorization).toBeUndefined();
    expect(response.status).toBe(200);
  });
});
