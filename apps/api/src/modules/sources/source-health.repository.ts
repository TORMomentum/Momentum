import { SUPPORTING_DOCUMENT_TYPES } from "@tor-radar/shared";
import type { Db } from "mongodb";
import { accounts, sourceHealth, tors, type SourceHealthDocument } from "../../core/db.js";
import type { SourceDefinition } from "./sources.registry.js";

/** A run's outcome, as the source's process reports it. */
export interface RunOutcome {
  ok: boolean;
  items: number;
  failed: number;
  error: string | null;
}

const EMPTY = { lastSuccessAt: null, lastFailureAt: null, lastError: null, lastRun: null, alert: null } as const;

/** Reads and writes for source health (TOR-87). Only this file touches the database for it. */
export class SourceHealthRepository {
  constructor(private readonly db: Db) {}

  async recordRun(id: string, outcome: RunOutcome, at: Date): Promise<void> {
    const lastRun = { at, items: outcome.items, failed: outcome.failed };
    if (outcome.ok) {
      await sourceHealth(this.db).updateOne(
        { _id: id },
        {
          $set: { lastSeenAt: at, lastSuccessAt: at, consecutiveFailures: 0, lastRun, updatedAt: at },
          $setOnInsert: { lastFailureAt: null, lastError: null, alert: null },
        },
        { upsert: true },
      );
      return;
    }
    await sourceHealth(this.db).updateOne(
      { _id: id },
      {
        $set: { lastSeenAt: at, lastFailureAt: at, lastError: outcome.error, lastRun, updatedAt: at },
        $inc: { consecutiveFailures: 1 },
        $setOnInsert: { lastSuccessAt: null, alert: null },
      },
      { upsert: true },
    );
  }

  /** The source's process is alive, though it asked the source nothing. */
  async heartbeat(id: string, at: Date): Promise<void> {
    await sourceHealth(this.db).updateOne(
      { _id: id },
      { $set: { lastSeenAt: at, updatedAt: at }, $setOnInsert: { ...EMPTY, consecutiveFailures: 0 } },
      { upsert: true },
    );
  }

  async all(): Promise<SourceHealthDocument[]> {
    return sourceHealth(this.db).find({}).toArray();
  }

  /** What a source has given us, and when it last did. */
  async recordsOf(source: SourceDefinition): Promise<{ records: number; latestRecordAt: Date | null }> {
    const { system, measure } = source.records;
    const filter =
      measure === "stages"
        ? { "sourceProject.system": system, stagesCheckedAt: { $exists: true } }
        : measure === "awards"
          ? { "sourceProject.system": system, documentType: "award" as const, duplicateOf: null }
          : { "sourceProject.system": system, documentType: { $nin: [...SUPPORTING_DOCUMENT_TYPES] }, duplicateOf: null };
    const field = measure === "stages" ? "stagesCheckedAt" : "createdAt";
    const [records, newest] = await Promise.all([
      tors(this.db).countDocuments(filter),
      tors(this.db).findOne(filter, { sort: { [field]: -1 }, projection: { [field]: 1 } }),
    ]);
    const latest = newest ? (newest as Record<string, unknown>)[field] : null;
    return { records, latestRecordAt: latest instanceof Date ? latest : null };
  }

  /** Opens an alert, once: true only for the caller that set it. */
  async claimAlert(id: string, kind: "failing" | "stale", at: Date): Promise<boolean> {
    const result = await sourceHealth(this.db).updateOne({ _id: id, alert: null }, { $set: { alert: { kind, sentAt: at }, updatedAt: at } });
    return result.modifiedCount === 1;
  }

  /** Closes an open alert, once: true only for the caller that cleared it. */
  async clearAlert(id: string, at: Date): Promise<boolean> {
    const result = await sourceHealth(this.db).updateOne({ _id: id, alert: { $ne: null } }, { $set: { alert: null, updatedAt: at } });
    return result.modifiedCount === 1;
  }

  /** Every admin who can be written to: a verified address, not disabled, not deleted. */
  async adminEmails(): Promise<string[]> {
    const admins = await accounts(this.db)
      .find(
        { role: "admin", emailVerifiedAt: { $exists: true }, disabledAt: { $exists: false }, deletedAt: { $exists: false }, deletingAt: { $exists: false } },
        { projection: { email: 1 } },
      )
      .toArray();
    return admins.map((admin) => admin.email);
  }
}
