import { ObjectId, type Db } from "mongodb";
import { torEvents, tors, type TorDocument } from "../../core/db.js";
import type { TorFields } from "@tor-radar/shared";
import type { StoredObject } from "../../ports/storage.port.js";
import type { SourceContext } from "./intake.service.js";

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

/**
 * Stamped on every record so a reader can tell which shape it is holding.
 * Slices 2-4 each add fields; without this marker, "absent" and "not yet
 * written by that slice" are indistinguishable, and a migration has nothing
 * to select on. Bump it when the shape of a written record changes.
 */
export const TOR_SCHEMA_VERSION = 2;

/** A source context as record fields; nothing for a plain upload. */
function contextFields(context: SourceContext | undefined): Partial<TorDocument> {
  if (!context) return {};
  const fields: Partial<TorDocument> = {};
  if (context.documentType) fields.documentType = context.documentType;
  if (context.sourceProject) fields.sourceProject = context.sourceProject;
  if (context.announcedAt) {
    fields.announcedAt = context.announcedAt;
    fields.announcedAtOrigin = "source";
  }
  return fields;
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
    knownFields?: Partial<TorFields>,
    context?: SourceContext,
  ): Promise<string> {
    const now = new Date();
    const result = await tors(this.db).insertOne({
      schemaVersion: TOR_SCHEMA_VERSION,
      contentHash,
      storage: storedObject,
      sourceRefs: [source],
      pipeline: { state: "queued", attempts: 0 },
      fields: knownFields ?? {},
      // The agency's own publication date, extracted in slice 2. Never the
      // ingestion time: FR-E-1's trend and FR-E-3's filter mean the agency's
      // date, and defaulting it here would report a backfill as today's work.
      announcedAt: null,
      ...contextFields(context),
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
    const torId = result.insertedId.toString();

    // The record keeps the last few transitions for the detail screen; the
    // complete trail is appended here and never updated. The record is written
    // first because the unique index on contentHash is what rejects a duplicate
    // submission - writing the event first would leave an event behind for a
    // record that was never created.
    await torEvents(this.db).insertOne({
      torId,
      from: null,
      to: "queued",
      at: now,
      actor: source.submittedBy,
      source: source.route,
    });

    return torId;
  }


  /** Records what a source states about a document that was already stored. */
  async attachSourceContext(id: string, context: SourceContext): Promise<void> {
    const fields = contextFields(context);
    if (Object.keys(fields).length === 0) return;
    await tors(this.db).updateOne({ _id: new ObjectId(id) }, { $set: { ...fields, updatedAt: new Date() } });
  }

  /** FR-A-3: the same document arriving again records the new source, not a new record. */
  async appendSourceRef(id: string, source: SourceRefInput): Promise<void> {
    await tors(this.db).updateOne(
      { _id: new ObjectId(id) },
      { $push: { sourceRefs: source }, $set: { updatedAt: new Date() } },
    );
  }
}
