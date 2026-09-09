import "../test/env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { connect, disconnect, ensureIndexes, jobs } from "../core/db.js";
import { MongoQueue } from "./mongo.queue.js";
import { loadConfig } from "../core/config.js";
import type { Job } from "../ports/queue.port.js";

const config = loadConfig(process.env);
let db: Db;
let queue: MongoQueue;

/**
 * `claim` is typed `Job | null` and the strict build compiles the tests too, so
 * the null case has to be discharged rather than asserted away. Failing here is
 * a real failure: a claim that returned nothing is not a passing test.
 */
function requireJob(job: Job | null): Job {
  expect(job).not.toBeNull();
  if (!job) throw new Error("expected claim() to return a job");
  return job;
}

beforeAll(async () => {
  db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  queue = new MongoQueue(db, {
    maxAttempts: config.jobMaxAttempts,
    backoffMs: config.jobBackoffMs,
    lockMs: config.jobLockMs,
  });
});

beforeEach(async () => {
  await jobs(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("MongoQueue", () => {
  it("claims an enqueued job", async () => {
    await queue.enqueue("tor-1");
    const claimed = await queue.claim();
    expect(claimed?.torId).toBe("tor-1");
  });

  it("never hands the same job to two claimants", async () => {
    await queue.enqueue("tor-1");
    const [first, second] = await Promise.all([queue.claim(), queue.claim()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("does not create a second live job for the same record", async () => {
    await queue.enqueue("tor-1");
    await queue.enqueue("tor-1");
    expect(await jobs(db).countDocuments({ torId: "tor-1" })).toBe(1);
  });

  it("returns null when nothing is due", async () => {
    expect(await queue.claim()).toBeNull();
  });

  it("schedules a retry on failure while attempts remain", async () => {
    await queue.enqueue("tor-1");
    const job = requireJob(await queue.claim());
    const result = await queue.fail(job.id, "vertex timeout");
    expect(result.willRetry).toBe(true);

    const stored = await jobs(db).findOne({ torId: "tor-1" });
    expect(stored?.state).toBe("pending");
    expect(stored?.attempts).toBe(1);
    expect(stored?.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("gives up permanently once attempts are exhausted", async () => {
    await queue.enqueue("tor-1");
    for (let attempt = 0; attempt < config.jobMaxAttempts; attempt += 1) {
      await jobs(db).updateOne({ torId: "tor-1" }, { $set: { nextRunAt: new Date(0) } });
      const job = requireJob(await queue.claim());
      await queue.fail(job.id, "still failing");
    }
    expect((await jobs(db).findOne({ torId: "tor-1" }))?.state).toBe("failed");
  });
});
