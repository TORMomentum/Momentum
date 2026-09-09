import { ObjectId, type Db } from "mongodb";
import { tors, type TorDocument } from "../../core/db.js";
import type { ExtractedField } from "@tor-radar/shared";
import type { StoredObject } from "../../ports/storage.port.js";

export interface SourceRefInput {
  route: "upload" | "url" | "api";
  url?: string;
  submittedBy: string;
  submittedAt: Date;
}

export interface FoundTor {
  id: string;
  contentHash: string;
  pipeline: { state: string; attempts: number };
}

/** The only intake code that touches MongoDB. */
export class IntakeRepository {
  constructor(private readonly db: Db) {}

  async findByHash(contentHash: string): Promise<FoundTor | null> {
    const document = await tors(this.db).findOne({ contentHash });
    if (!document) return null;
    return {
      id: document._id.toString(),
      contentHash: document.contentHash,
      pipeline: { state: document.pipeline.state, attempts: document.pipeline.attempts },
    };
  }

  /**
   * Throws a duplicate-key error (code 11000) when the hash already exists.
   * That error is the real dedupe guarantee under concurrency, not the
   * findByHash check that precedes it.
   */
  async insert(
    contentHash: string,
    storedObject: StoredObject,
    source: SourceRefInput,
    knownFields?: Record<string, ExtractedField>,
  ): Promise<string> {
    const now = new Date();
    const result = await tors(this.db).insertOne({
      contentHash,
      storage: storedObject,
      sourceRefs: [source],
      pipeline: { state: "queued", attempts: 0 },
      fields: knownFields ?? {},
      // The agency's own publication date, extracted in slice 2. Never the
      // ingestion time: FR-E-1's trend and FR-E-3's filter mean the agency's
      // date, and defaulting it here would report a backfill as today's work.
      announcedAt: null,
      sourceUrl: source.url ?? null,
      unverified: true,
      statusHistory: [
        { from: null, to: "queued", at: now, actor: source.submittedBy, source: source.route },
      ],
      access: { restricted: false },
      duplicateOf: null,
      createdAt: now,
      updatedAt: now,
    } as TorDocument);
    return result.insertedId.toString();
  }

  /** FR-A-3: the same document arriving again records the new source, not a new record. */
  async appendSourceRef(id: string, source: SourceRefInput): Promise<void> {
    await tors(this.db).updateOne(
      { _id: new ObjectId(id) },
      { $push: { sourceRefs: source }, $set: { updatedAt: new Date() } },
    );
  }
}
