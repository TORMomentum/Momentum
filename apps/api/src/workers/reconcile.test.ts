import "../test/env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { connect, disconnect, ensureIndexes, jobs, tors } from "../core/db.js";
import { MongoQueue } from "../adapters/mongo.queue.js";
import { loadConfig } from "../core/config.js";
import { isolatedDbUrl } from "../test/mongo.js";
import { reconcileOrphanedRecords } from "./reconcile.js";

const config = loadConfig(process.env);
const mongoUrl = isolatedDbUrl(config.mongoUrl, "reconcile");
let db: Db;
let queue: MongoQueue;

const record = (createdAt: Date) => ({
  contentHash: "hash-" + createdAt.getTime(),
  storage: { bucket: "tor-raw", key: "k", contentType: "application/pdf", bytes: 1 },
  sourceRefs: [],
  pipeline: { state: "queued", attempts: 0 },
  fields: {},
  announcedAt: null,
  sourceUrl: null,
  unverified: true,
  statusHistory: [],
  access: { restricted: false },
  duplicateOf: null,
  createdAt,
  updatedAt: createdAt,
});

beforeAll(async () => {
  db = await connect(mongoUrl);
  await ensureIndexes(db);
  queue = new MongoQueue(db, {
    maxAttempts: config.jobMaxAttempts,
    backoffMs: config.jobBackoffMs,
    lockMs: config.jobLockMs,
  });
});

beforeEach(async () => {
  await tors(db).deleteMany({});
  await jobs(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("reconcileOrphanedRecords", () => {
  it("enqueues a queued record old enough to have no job", async () => {
    const old = new Date(Date.now() - config.reconcileMinAgeMs - 1_000);
    await tors(db).insertOne(record(old) as never);

    const requeued = await reconcileOrphanedRecords(db, queue, config.reconcileMinAgeMs);

    expect(requeued).toBe(1);
    expect(await jobs(db).countDocuments()).toBe(1);
  });

  it("leaves a record that already has a job alone", async () => {
    const old = new Date(Date.now() - config.reconcileMinAgeMs - 1_000);
    const inserted = await tors(db).insertOne(record(old) as never);
    await queue.enqueue(inserted.insertedId.toString());

    const requeued = await reconcileOrphanedRecords(db, queue, config.reconcileMinAgeMs);

    expect(requeued).toBe(0);
    expect(await jobs(db).countDocuments()).toBe(1);
  });

  it("leaves a record younger than the minimum age alone, since its enqueue may be in flight", async () => {
    await tors(db).insertOne(record(new Date()) as never);

    const requeued = await reconcileOrphanedRecords(db, queue, config.reconcileMinAgeMs);

    expect(requeued).toBe(0);
    expect(await jobs(db).countDocuments()).toBe(0);
  });

  it("ignores records that have already left the queued state", async () => {
    const old = new Date(Date.now() - config.reconcileMinAgeMs - 1_000);
    await tors(db).insertOne({ ...record(old), pipeline: { state: "published", attempts: 0 } } as never);

    const requeued = await reconcileOrphanedRecords(db, queue, config.reconcileMinAgeMs);

    expect(requeued).toBe(0);
    expect(await jobs(db).countDocuments()).toBe(0);
  });
});
