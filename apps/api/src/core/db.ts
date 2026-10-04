import { MongoClient, type Collection, type Db } from "mongodb";
import type { ConfidenceLevel, DocumentType, Provenance, SourceProject, TorFields } from "@tor-radar/shared";
import type { CohortKey } from "../modules/stats/cohort.js";
import { eligibleFilter } from "../modules/stats/eligibility.js";

export interface TorDocument {
  contentHash: string;
  storage: { bucket: string; key: string; contentType: string; bytes: number };
  sourceRefs: Array<{
    route: string;
    url?: string;
    submittedBy: string;
    submittedAt: Date;
    originalFilename?: string;
  }>;
  pipeline: { state: string; attempts: number; failedReason?: string };
  /** The nine FR-B-2 fields, populated in slice 2. Empty until extraction runs. */
  fields: Partial<TorFields>;
  /** The TOR's own publication date, extracted in slice 2 - never the ingestion time. */
  announcedAt: Date | null;
  /** "source" when the source system stated `announcedAt`; extraction then leaves it alone. */
  announcedAtOrigin?: "source";
  /** Absent means "tor". An invitation only supplies fields its project's TOR lacks. */
  documentType?: DocumentType;
  /** The source project this document belongs to — what links a TOR to its invitation. */
  sourceProject?: SourceProject;
  sourceUrl: string | null;
  confidenceLevel?: ConfidenceLevel;
  unverified: boolean;
  /** Digital PDF text layer vs an OCR'd scan - drives grading (SRS §4.2.1). */
  hasTextLayer?: boolean;
  /** Why the record is in the review queue (FR-G-1); absent or empty otherwise. */
  reviewReasons?: string[];
  provenance?: Provenance;
  /**
   * The most recent transitions only, for the detail screen (FR-E-5). Capped at
   * STATUS_HISTORY_KEPT on every write: an array that only ever grows is
   * MongoDB's first-listed anti-pattern, because the whole document is read and
   * rewritten as one unit. The complete trail lives in `tor_events`.
   */
  statusHistory: Array<{ from: string | null; to: string; at: Date; actor: string; source: string }>;
  access: { restricted: boolean; reason?: string; auditRef?: string };
  /** The stable peer-group key used by the dashboard anomaly rule. */
  cohort?: CohortKey;
  cohortDateSource?: "announced" | "intake";
  duplicateOf: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One transition, appended and never updated. The audit trail (FR-E-5). */
export interface TorEventDocument {
  torId: string;
  from: string | null;
  to: string;
  at: Date;
  actor: string;
  source: string;
  reason?: string;
}

/**
 * How many transitions the TOR document itself keeps for display. The events
 * collection keeps all of them, so this is a display budget, not a retention
 * policy - lowering it loses nothing.
 */
export const STATUS_HISTORY_KEPT = 10;

/**
 * One admin edit to one field, kept forever (FR-G-2): the correction is the
 * training signal for a later extractor, and the audit trail for a published
 * value that a human changed. Never updated, only appended.
 */
export interface CorrectionDocument {
  torId: string;
  field: string;
  before: unknown;
  after: unknown;
  actor: string;
  at: Date;
}

export interface JobDocument {
  torId: string;
  type: "extract";
  state: "pending" | "running" | "failed" | "done";
  attempts: number;
  lastError?: string;
  nextRunAt: Date;
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** One cached peer group and the durable work item that keeps it current. */
export interface TorPeerStatsDocument {
  category: string;
  month: string;
  n?: number;
  q1?: number;
  q3?: number;
  iqr?: number;
  lowBound?: number;
  highBound?: number;
  mean?: number;
  stdDev?: number;
  method?: "IQR" | "ZSCORE";
  minN?: number;
  windowMonths?: number;
  computedAt?: Date;
  dirty: boolean;
  dirtyAt?: Date;
  generation: number;
  leaseOwner?: string;
  leaseUntil?: Date;
}

/** A precomputed dashboard total for one agency/category/month cell. */
export interface TorRollupDocument {
  agency: string;
  category: string;
  month: string;
  torCount: number;
  budgetSum: number;
  unverifiedBudgetCount: number;
  flaggedCount: number;
  computedAt: Date;
}

/** Singleton dashboard freshness metadata. */
export interface TorMetaDocument {
  _id: "dashboard";
  lastIntakeAt?: Date;
  statsComputedAt?: Date;
  corpusSize?: number;
}

let client: MongoClient | null = null;

export async function connect(mongoUrl: string): Promise<Db> {
  client = new MongoClient(mongoUrl);
  await client.connect();
  return client.db();
}

export async function disconnect(): Promise<void> {
  await client?.close();
  client = null;
}

export function tors(db: Db): Collection<TorDocument> {
  return db.collection<TorDocument>("tors");
}

export function jobs(db: Db): Collection<JobDocument> {
  return db.collection<JobDocument>("ingest_jobs");
}

export function torEvents(db: Db): Collection<TorEventDocument> {
  return db.collection<TorEventDocument>("tor_events");
}

export function corrections(db: Db): Collection<CorrectionDocument> {
  return db.collection<CorrectionDocument>("corrections");
}

export function torPeerStats(db: Db): Collection<TorPeerStatsDocument> {
  return db.collection<TorPeerStatsDocument>("tor_peer_stats");
}

export function torRollups(db: Db): Collection<TorRollupDocument> {
  return db.collection<TorRollupDocument>("tor_rollups");
}

export function torMeta(db: Db): Collection<TorMetaDocument> {
  return db.collection<TorMetaDocument>("tor_meta");
}

/** Indexes from spec section 4.5. The unique contentHash index is the dedupe guarantee. */
export async function ensureIndexes(db: Db): Promise<void> {
  await tors(db).createIndex({ contentHash: 1 }, { unique: true });
  await tors(db).createIndex({ "pipeline.state": 1, createdAt: -1 });
  // Aggregations and peer groups select on the AGENCY's date, so these index
  // announcedAt rather than ingestion time. The agency + announcedAt pair is
  // served by the three-field compound below, whose prefix covers it - one
  // index, not two, because every extra index is paid for on every write.
  await tors(db).createIndex({ "fields.category.value": 1, announcedAt: -1 });
  // The _id suffix is the public list's cursor tie-breaker, so the unfiltered
  // listing reads its order straight from this index (search spec §4).
  await tors(db).createIndex({ announcedAt: -1, _id: -1 });
  // The list's leading segment — still taking bids, closing soonest first —
  // reads its order and cursor tie-breaker from this one.
  await tors(db).createIndex({ "fields.deadline.value": 1, _id: 1 });
  await tors(db).createIndex({
    "fields.agency.value": 1,
    announcedAt: -1,
    "fields.torStatus.value": 1,
  });
  await tors(db).createIndex({ "access.restricted": 1 });
  // Keep this identical to eligibleFilter(): the partial index is the database
  // enforcement of eligibility, so a drift would make the rule scan a different corpus.
  await tors(db).createIndex(
    { "cohort.category": 1, "cohort.month": 1, "fields.budget.value": 1 },
    { partialFilterExpression: eligibleFilter() },
  );
  await tors(db).createIndex({ "fields.agency.value": 1, "cohort.month": 1 });
  await tors(db).createIndex({ "cohort.category": 1, "cohort.month": 1 });
  // Every audit read is "this TOR, newest first". A collection growing to
  // millions of small documents is ordinary; a document growing is not.
  await torEvents(db).createIndex({ torId: 1, at: -1 });
  // The review queue: records still needing a human, oldest first so nothing
  // starves. `unverified` leads because approval clears it, which is what takes
  // a record out of the queue.
  await tors(db).createIndex({ unverified: 1, confidenceLevel: 1, createdAt: 1 });
  // Corrections are read per record (audit) and per field (few-shot examples).
  await corrections(db).createIndex({ torId: 1, at: -1 });
  await corrections(db).createIndex({ field: 1, at: -1 });
  await jobs(db).createIndex({ state: 1, nextRunAt: 1 });
  await jobs(db).createIndex({ torId: 1, state: 1 });
  await torPeerStats(db).createIndex({ category: 1, month: 1 }, { unique: true });
  await torPeerStats(db).createIndex({ dirty: 1, dirtyAt: 1 }, { partialFilterExpression: { dirty: true } });
  await torRollups(db).createIndex({ agency: 1, month: 1 });
  await torRollups(db).createIndex({ category: 1, month: 1 });
  await torRollups(db).createIndex({ month: 1 });
  await torRollups(db).createIndex({ agency: 1, category: 1, month: 1 }, { unique: true });
}
