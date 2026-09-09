import "../test/env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { connect, disconnect, ensureIndexes, jobs, tors } from "../core/db.js";
import { MongoQueue } from "../adapters/mongo.queue.js";
import { loadConfig } from "../core/config.js";
import { isolatedDbUrl } from "../test/mongo.js";
import { runOnce, torTransitions, passThroughHandler, type ExtractionHandler } from "./extract.worker.js";

/**
 * The end-to-end seam: a record inserted as `queued` with a job on the queue
 * reaches `published` through the real worker cycle, before any AI is wired.
 * Slice 2 swaps `passThroughHandler` for the extraction service; this path
 * does not change.
 */
const config = loadConfig(process.env);
const mongoUrl = isolatedDbUrl(config.mongoUrl, "seam");
let db: Db;
let queue: MongoQueue;

const queuedRecord = () => ({
  contentHash: "hash-" + Math.random(),
  storage: { bucket: "tor-raw", key: "k", contentType: "application/pdf", bytes: 1 },
  sourceRefs: [{ route: "upload", submittedBy: "admin", submittedAt: new Date() }],
  pipeline: { state: "queued", attempts: 0 },
  fields: {},
  announcedAt: null,
  sourceUrl: null,
  unverified: true,
  statusHistory: [],
  access: { restricted: false },
  duplicateOf: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

async function seedQueuedTor(): Promise<string> {
  const { insertedId } = await tors(db).insertOne(queuedRecord() as never);
  await queue.enqueue(insertedId.toString());
  return insertedId.toString();
}

function deps(handle: ExtractionHandler) {
  return { queue, handle, ...torTransitions(db) };
}

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

describe("worker seam against the real database", () => {
  it("carries a queued record to published and marks the job done", async () => {
    const torId = await seedQueuedTor();

    expect(await runOnce(deps(passThroughHandler))).toBe("published");

    const doc = await tors(db).findOne({ _id: new ObjectId(torId) });
    expect(doc?.pipeline.state).toBe("published");
    expect(await jobs(db).countDocuments({ torId, state: "done" })).toBe(1);
  });

  it("runs the handler while the record is in extracting, not before", async () => {
    await seedQueuedTor();
    let stateSeenByHandler: string | undefined;
    const handle: ExtractionHandler = async (id) => {
      stateSeenByHandler = (await tors(db).findOne({ _id: new ObjectId(id) }))?.pipeline.state;
    };

    await runOnce(deps(handle));

    expect(stateSeenByHandler).toBe("extracting");
  });

  it("marks the record failed with the reason once retries are exhausted", async () => {
    const torId = await seedQueuedTor();
    const handle: ExtractionHandler = async () => {
      throw new Error("document is unreadable");
    };

    let result = await runOnce(deps(handle));
    while (result === "retry") {
      // exhaust the retries; each fail() schedules a backoff, so make the job due again
      await jobs(db).updateMany({ torId }, { $set: { nextRunAt: new Date(0) } });
      result = await runOnce(deps(handle));
    }

    expect(result).toBe("failed");
    const doc = await tors(db).findOne({ _id: new ObjectId(torId) });
    expect(doc?.pipeline.state).toBe("failed");
    expect(doc?.pipeline.failedReason).toBe("document is unreadable");
    // NFR-S5: the record and its storage reference are still there.
    expect(doc?.storage.key).toBe("k");
  });
});
