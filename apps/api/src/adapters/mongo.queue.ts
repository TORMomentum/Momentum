import { ObjectId, type Db } from "mongodb";
import { jobs, type JobDocument } from "../core/db.js";
import type { Job, Queue } from "../ports/queue.port.js";

export interface QueueSettings {
  maxAttempts: number;
  backoffMs: number;
  lockMs: number;
}

export class MongoQueue implements Queue {
  constructor(
    private readonly db: Db,
    private readonly settings: QueueSettings,
  ) {}

  /**
   * Idempotent: the reconciler may enqueue a record that already has a live
   * job, and that must not produce duplicate work.
   */
  async enqueue(torId: string): Promise<void> {
    const now = new Date();
    await jobs(this.db).updateOne(
      { torId, state: { $in: ["pending", "running"] } },
      {
        $setOnInsert: {
          torId,
          type: "extract",
          state: "pending",
          attempts: 0,
          nextRunAt: now,
          createdAt: now,
          updatedAt: now,
        } as JobDocument,
      },
      { upsert: true },
    );
  }

  /**
   * findOneAndUpdate is atomic, so two workers racing for the same document
   * produce exactly one winner. The lock expiry lets a job abandoned by a
   * crashed or stopped worker become claimable again: such a job is still
   * "running", so a claim that looked only at "pending" would never see it.
   */
  async claim(): Promise<Job | null> {
    const now = new Date();
    const result = await jobs(this.db).findOneAndUpdate(
      {
        state: { $in: ["pending", "running"] },
        nextRunAt: { $lte: now },
        $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }],
      },
      {
        $set: {
          state: "running",
          lockedUntil: new Date(now.getTime() + this.settings.lockMs),
          updatedAt: now,
        },
      },
      { sort: { nextRunAt: 1 }, returnDocument: "after" },
    );
    if (!result) return null;
    return {
      id: result._id.toString(),
      torId: result.torId,
      type: "extract",
      attempts: result.attempts,
    };
  }

  async complete(jobId: string): Promise<void> {
    await jobs(this.db).updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { state: "done", updatedAt: new Date() }, $unset: { lockedUntil: "" } },
    );
  }

  async abandon(jobId: string, reason: string): Promise<void> {
    await jobs(this.db).updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { state: "failed", lastError: reason, updatedAt: new Date() }, $unset: { lockedUntil: "" } },
    );
  }

  async fail(jobId: string, reason: string): Promise<{ willRetry: boolean }> {
    const now = new Date();
    const job = await jobs(this.db).findOne({ _id: new ObjectId(jobId) });
    if (!job) return { willRetry: false };

    const attempts = job.attempts + 1;
    const willRetry = attempts < this.settings.maxAttempts;
    await jobs(this.db).updateOne(
      { _id: new ObjectId(jobId) },
      {
        $set: {
          state: willRetry ? "pending" : "failed",
          attempts,
          lastError: reason,
          nextRunAt: new Date(now.getTime() + this.settings.backoffMs * attempts),
          updatedAt: now,
        },
        $unset: { lockedUntil: "" },
      },
    );
    return { willRetry };
  }
}
