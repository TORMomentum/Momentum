import { ObjectId, type Db, type Filter } from "mongodb";
import type { ExtractedField, TorFields } from "@tor-radar/shared";
import { corrections, torEvents, tors, type TorDocument } from "../../core/db.js";
import { NotFoundError } from "../../core/errors.js";
import { parseBudget } from "../../lib/parse-budget.js";

/** One row in the queue list — enough to choose what to open, nothing more. */
export interface QueueEntry {
  id: string;
  title: string;
  agency: string;
  confidence: number;
  reviewReasons: string[];
  route: string;
  submittedAt: Date;
  contentType: string;
}

/** Everything the side-by-side editor needs for one record. */
export interface ReviewRecord extends QueueEntry {
  /** Filled by the service, which knows the thresholds. */
  flaggedFields?: string[];
  fields: Partial<TorFields>;
  storage: { key: string; contentType: string; bytes: number };
  hasTextLayer: boolean;
  sourceUrl: string | null;
  contentHash: string;
  filename?: string;
  /** Where the record is in the pipeline, and whether the public can see it. */
  state: string;
  restricted: boolean;
  restrictedReason?: string;
  documentType: "tor" | "invitation";
}

/** Which records the all-TORs list shows. */
export type AdminTorStatus = "all" | "public" | "restricted" | "unverified" | "processing" | "stuck" | "failed";

export interface AdminTorQuery {
  /** Words in the title or agency, or a project number. */
  q?: string;
  status: AdminTorStatus;
  /** "tor" leaves out invitations to bid, which are supporting documents. */
  kind: "tor" | "invitation" | "all";
  page: number;
  pageSize: number;
}

/** One row of the all-TORs list. */
export interface AdminTorRow {
  id: string;
  title: string;
  agency: string;
  documentType: "tor" | "invitation";
  state: string;
  restricted: boolean;
  unverified: boolean;
  confidenceLevel: string | null;
  projectNumber: string | null;
  createdAt: Date;
}

export interface AdminTorPage {
  rows: AdminTorRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** A search term as a literal pattern: nothing a reviewer types is read as regex syntax. */
function literal(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

export interface AdminOverview {
  needsReview: number;
  unverifiedNotQueued: number;
  published: number;
  failed: number;
  corrections: number;
  stored: number;
  /** Queued or extracting, untouched longer than a worker should take. */
  stuck: number;
}

export interface AdminEvent {
  torId: string;
  title: string;
  from: string | null;
  to: string;
  actor: string;
  source: string;
  reason?: string;
  at: Date;
}

export interface FieldEdit {
  field: keyof TorFields;
  /** What the reviewer typed. `budget` is normalised before it is stored as `value`. */
  value: string;
}

/** The nine required FR-B-2 fields; optional display extras are not review fields. */
export type ReviewFieldName = {
  [Field in keyof TorFields]-?: object extends Pick<TorFields, Field> ? never : Field;
}[keyof TorFields];

/**
 * The only admin code that touches MongoDB.
 *
 * The queue is a query, not a collection: a record is in it because it graded
 * `low`, not because something copied it somewhere. That means a re-extraction
 * can take a record out of the queue by changing its grade, with nothing to
 * keep in step.
 */
export class AdminRepository {
  constructor(
    private readonly db: Db,
    private readonly budgetMaxThb: number,
    /** A record still queued or extracting, untouched this long, is stuck. */
    private readonly stuckAfterMs: number = Number.POSITIVE_INFINITY,
  ) {}

  /** Still in the pipeline, and nothing has touched it for longer than a worker should take. */
  private stuckFilter() {
    return { "pipeline.state": { $in: ["queued", "extracting"] }, updatedAt: { $lt: new Date(Date.now() - this.stuckAfterMs) } };
  }

  /**
   * Oldest first, so a record cannot starve behind a steady arrival of newer
   * ones — a queue ordered by confidence would leave the worst documents
   * permanently at the bottom.
   */
  async listQueue(limit: number, reason?: string): Promise<QueueEntry[]> {
    const filter: Record<string, unknown> = {
      confidenceLevel: "low",
      // Still needing a human is what puts a record here — not its grade alone.
      // An approved record keeps confidenceLevel "low" forever, because that
      // records what the model produced; `unverified` is what the approval
      // clears, so this is the condition that empties the queue.
      unverified: true,
      "pipeline.state": "published",
      "access.restricted": { $ne: true },
    };
    if (reason) filter.reviewReasons = reason;

    const docs = await tors(this.db)
      .find(filter, { sort: { createdAt: 1 }, limit })
      .toArray();

    return docs.map((doc) => ({
      id: doc._id.toString(),
      title: doc.fields?.title?.raw ?? "",
      agency: doc.fields?.agency?.raw ?? "",
      confidence: doc.fields?.agency?.confidence ?? 0,
      reviewReasons: doc.reviewReasons ?? [],
      route: doc.sourceRefs[0]?.route ?? "unknown",
      submittedAt: doc.sourceRefs[0]?.submittedAt ?? doc.createdAt,
      contentType: doc.storage.contentType,
    }));
  }

  /**
   * TORs whose critical fields are settled but whose category or qualifications are not yet
   * verified — the △ a reader sees in the specification-quality checklist (checks C4, C5). They
   * never reach the confidence queue, which only takes low records, so they are listed here.
   */
  private fieldsToConfirmFilter(): Filter<TorDocument> {
    return {
      "pipeline.state": "published",
      "access.restricted": { $ne: true },
      documentType: { $ne: "invitation" },
      duplicateOf: null,
      confidenceLevel: { $ne: "low" },
      $or: [{ "fields.category.verified": false }, { "fields.qualifications.verified": false }],
    };
  }

  async listFieldsToConfirm(limit: number): Promise<QueueEntry[]> {
    const docs = await tors(this.db)
      .find(this.fieldsToConfirmFilter(), { sort: { createdAt: 1 }, limit })
      .toArray();

    return docs.map((doc) => ({
      id: doc._id.toString(),
      title: doc.fields?.title?.raw ?? "",
      agency: doc.fields?.agency?.raw ?? "",
      confidence: doc.fields?.agency?.confidence ?? 0,
      // Which fields still need a person, in the queue's own reason shape.
      reviewReasons: [
        ...(doc.fields?.category?.verified === false ? ["category-unconfirmed"] : []),
        ...(doc.fields?.qualifications?.verified === false ? ["qualifications-unconfirmed"] : []),
      ],
      route: doc.sourceRefs[0]?.route ?? "unknown",
      submittedAt: doc.sourceRefs[0]?.submittedAt ?? doc.createdAt,
      contentType: doc.storage.contentType,
    }));
  }

  async countFieldsToConfirm(): Promise<number> {
    return tors(this.db).countDocuments(this.fieldsToConfirmFilter());
  }

  /** How many records are unverified but never queued — the "not queued" figure. */
  async countUnverifiedNotQueued(): Promise<number> {
    return tors(this.db).countDocuments({
      unverified: true,
      confidenceLevel: { $ne: "low" },
      "pipeline.state": "published",
    });
  }

  async load(torId: string): Promise<ReviewRecord> {
    const doc = await tors(this.db).findOne({ _id: new ObjectId(torId) });
    if (!doc) throw new NotFoundError(`tor ${torId} not found`);

    return {
      id: doc._id.toString(),
      title: doc.fields?.title?.raw ?? "",
      agency: doc.fields?.agency?.raw ?? "",
      confidence: doc.fields?.agency?.confidence ?? 0,
      reviewReasons: doc.reviewReasons ?? [],
      route: doc.sourceRefs[0]?.route ?? "unknown",
      submittedAt: doc.sourceRefs[0]?.submittedAt ?? doc.createdAt,
      contentType: doc.storage.contentType,
      fields: doc.fields ?? {},
      storage: { key: doc.storage.key, contentType: doc.storage.contentType, bytes: doc.storage.bytes },
      hasTextLayer: doc.hasTextLayer ?? false,
      sourceUrl: doc.sourceUrl,
      contentHash: doc.contentHash,
      filename: doc.sourceRefs?.find((s) => s.originalFilename)?.originalFilename,
      state: doc.pipeline?.state ?? "unknown",
      restricted: doc.access?.restricted ?? false,
      ...(doc.access?.reason ? { restrictedReason: doc.access.reason } : {}),
      documentType: doc.documentType ?? "tor",
    };
  }

  /**
   * Every record, published or not, public or taken down — the review queue sees only the ones a
   * model graded low, so a published record that turns out wrong could not be reached before.
   * Newest first; a page at a time.
   */
  async listAll(query: AdminTorQuery): Promise<AdminTorPage> {
    const and: Filter<TorDocument>[] = [];
    if (query.kind === "tor") and.push({ documentType: { $ne: "invitation" } });
    if (query.kind === "invitation") and.push({ documentType: "invitation" });
    const status: Record<Exclude<AdminTorStatus, "all">, Filter<TorDocument>> = {
      public: { "pipeline.state": "published", "access.restricted": { $ne: true } },
      restricted: { "access.restricted": true },
      unverified: { "pipeline.state": "published", unverified: true, "access.restricted": { $ne: true } },
      processing: { "pipeline.state": { $in: ["queued", "extracting"] } },
      failed: { "pipeline.state": "failed" },
      stuck: this.stuckFilter(),
    };
    if (query.status !== "all") and.push(status[query.status]);
    const q = query.q?.trim();
    if (q) {
      const pattern = literal(q);
      and.push({
        $or: [
          { "fields.title.raw": pattern },
          { "fields.title.value": pattern },
          { "fields.agency.raw": pattern },
          { "fields.agency.value": pattern },
          { "sourceProject.projectNumber": q },
          { "sourceProject.projectId": q },
        ],
      });
    }
    const filter: Filter<TorDocument> = and.length > 0 ? { $and: and } : {};
    const [docs, total] = await Promise.all([
      tors(this.db)
        .find(filter, {
          sort: { createdAt: -1, _id: -1 },
          skip: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
          projection: {
            "fields.title": 1,
            "fields.agency": 1,
            documentType: 1,
            pipeline: 1,
            access: 1,
            unverified: 1,
            confidenceLevel: 1,
            sourceProject: 1,
            createdAt: 1,
          },
        })
        .toArray(),
      tors(this.db).countDocuments(filter),
    ]);
    return {
      rows: docs.map((doc) => ({
        id: doc._id.toString(),
        title: doc.fields?.title?.raw ?? "",
        agency: doc.fields?.agency?.raw ?? "",
        documentType: doc.documentType ?? "tor",
        state: doc.pipeline?.state ?? "unknown",
        restricted: doc.access?.restricted ?? false,
        unverified: doc.unverified ?? false,
        confidenceLevel: doc.confidenceLevel ?? null,
        projectNumber: doc.sourceProject?.projectNumber ?? doc.sourceProject?.projectId ?? null,
        createdAt: doc.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Applies edits and records each one (FR-G-2).
   *
   * A corrected field is `verified: true` with `confidence: 1` — a human read
   * the document, which is a stronger signal than any model score, and the
   * grading rule that excluded it from statistics keys off `verified`.
   *
   * The correction row is written BEFORE the record changes: if the second
   * write fails, an unused example exists, which is harmless, rather than a
   * changed value nobody can trace.
   */
  async applyEdits(torId: string, edits: FieldEdit[], actor: string): Promise<TorDocument> {
    const doc = await tors(this.db).findOne({ _id: new ObjectId(torId) });
    if (!doc) throw new NotFoundError(`tor ${torId} not found`);

    const at = new Date();
    const set: Record<string, unknown> = { updatedAt: at };

    for (const edit of edits) {
      const before = doc.fields?.[edit.field] as ExtractedField<unknown> | undefined;
      const value = edit.field === "budget"
        ? parseBudget(edit.value, this.budgetMaxThb)
        : edit.field === "category"
          ? edit.value.trim()
          : edit.value;
      // The service validates before reaching this repository. Keeping this
      // guard here protects direct callers from reintroducing mixed BSON types.
      if (value === null) throw new Error("budget edit was not validated");
      const after = {
        ...(before ?? { evidence: undefined }),
        raw: edit.value,
        value,
        confidence: 1,
        verified: true,
      };

      await corrections(this.db).insertOne({
        torId,
        field: edit.field,
        before: before ?? null,
        after,
        actor,
        at,
      });

      set[`fields.${edit.field}`] = after;
    }

    await tors(this.db).updateOne({ _id: new ObjectId(torId) }, { $set: set });
    return doc;
  }

  async statsRecord(torId: string): Promise<TorDocument> {
    const doc = await tors(this.db).findOne({ _id: new ObjectId(torId) });
    if (!doc) throw new NotFoundError(`tor ${torId} not found`);
    return doc;
  }

  async setCohort(torId: string, cohort: TorDocument["cohort"], cohortDateSource: TorDocument["cohortDateSource"]): Promise<void> {
    await tors(this.db).updateOne({ _id: new ObjectId(torId) }, { $set: { cohort, cohortDateSource } });
  }

  /**
   * Records a human affirmation without turning it into extractor training
   * data. In particular, this deliberately does not touch `corrections`, the
   * field confidence, or the record confidence level.
   */
  async setFieldVerification(
    torId: string,
    field: ReviewFieldName,
    confirmed: boolean,
  ): Promise<TorDocument> {
    const result = await tors(this.db).findOneAndUpdate(
      { _id: new ObjectId(torId) },
      { $set: { [`fields.${field}.verified`]: confirmed, updatedAt: new Date() } },
      { returnDocument: "before" },
    );
    if (!result) throw new NotFoundError(`tor ${torId} not found`);
    return result;
  }

  /**
   * Clears the unverified mark so the record joins statistics and matching
   * (FR-G-1). It does NOT raise `confidenceLevel`: that field records what the
   * model produced, and rewriting it would erase the fact that this record
   * needed a human.
   */
  async approve(torId: string): Promise<void> {
    const result = await tors(this.db).updateOne(
      { _id: new ObjectId(torId) },
      { $set: { unverified: false, reviewReasons: [], updatedAt: new Date() } },
    );
    if (result.matchedCount === 0) throw new NotFoundError(`tor ${torId} not found`);
  }

  /**
   * Rejection restricts access and records why (FR-B-6). The stored document is
   * untouched — nothing in this system deletes an original, including a
   * reviewer deciding it was never a TOR.
   */
  async reject(torId: string, reason: string, actor: string): Promise<TorDocument> {
    const result = await tors(this.db).findOneAndUpdate(
      { _id: new ObjectId(torId) },
      {
        $set: {
          access: { restricted: true, reason, auditRef: `admin:${actor}` },
          unverified: true,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "before" },
    );
    if (!result) throw new NotFoundError(`tor ${torId} not found`);
    return result;
  }

  /**
   * Lifts a takedown: the record is public again. The reason it was taken down stays in the event
   * log, which is the audit trail; the stored original was never touched (FR-B-6).
   */
  async restore(torId: string): Promise<TorDocument> {
    const result = await tors(this.db).findOneAndUpdate(
      { _id: new ObjectId(torId) },
      { $set: { access: { restricted: false }, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) throw new NotFoundError(`tor ${torId} not found`);
    return result;
  }

  /** The numbers the admin landing page reports. One round trip, not five. */
  async overview(): Promise<AdminOverview> {
    const [needsReview, unverifiedNotQueued, published, failed, correctionsMade, stored, stuck] =
      await Promise.all([
        tors(this.db).countDocuments({
          confidenceLevel: "low",
          unverified: true,
          "pipeline.state": "published",
          "access.restricted": { $ne: true },
        }),
        this.countUnverifiedNotQueued(),
        tors(this.db).countDocuments({ "pipeline.state": "published" }),
        tors(this.db).countDocuments({ "pipeline.state": "failed" }),
        corrections(this.db).countDocuments(),
        tors(this.db).countDocuments(),
        tors(this.db).countDocuments(this.stuckFilter()),
      ]);

    return { needsReview, unverifiedNotQueued, published, failed, corrections: correctionsMade, stored, stuck };
  }

  /**
   * The activity log: every state change, newest first (FR-E-5). Titles are
   * fetched in one extra query rather than per row, because a log page renders
   * fifty of them.
   */
  async recentEvents(limit: number): Promise<AdminEvent[]> {
    const events = await torEvents(this.db).find({}, { sort: { at: -1 }, limit }).toArray();
    const ids = [...new Set(events.map((event) => event.torId))];

    const titles = new Map<string, string>();
    if (ids.length > 0) {
      const docs = await tors(this.db)
        .find(
          { _id: { $in: ids.map((id) => new ObjectId(id)) } },
          { projection: { "fields.title.raw": 1 } },
        )
        .toArray();
      for (const doc of docs) titles.set(doc._id.toString(), doc.fields?.title?.raw ?? "");
    }

    return events.map((event) => ({
      torId: event.torId,
      title: titles.get(event.torId) ?? "",
      from: event.from,
      to: event.to,
      actor: event.actor,
      source: event.source,
      reason: event.reason,
      at: event.at,
    }));
  }

  /** Every correction ever made to a record, newest first — the audit view. */
  async corrections(torId: string) {
    return corrections(this.db).find({ torId }, { sort: { at: -1 } }).toArray();
  }
}
