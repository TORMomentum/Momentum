import { MongoClient, type Collection, type Db } from "mongodb";
import type { ConfidenceLevel, DocumentType, Provenance, SourceProject, TorFields, StoredAnnex } from "@tor-radar/shared";
import type { CohortKey } from "../modules/stats/cohort.js";
import { eligibleFilter } from "../modules/stats/eligibility.js";
import type { TorClassification } from "../modules/matching/tor-classifier.js";

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
  /** The TOR's other files, stored as originals and read together with it (checklist C3). */
  annexes?: StoredAnnex[];
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

export type AccountRole = "vendor" | "admin";

export interface AccountDocument {
  email: string;
  displayName?: string;
  passwordHash?: string;
  emailVerifiedAt?: Date;
  google?: { sub: string };
  role: AccountRole;
  consent: {
    noticeVersion: string;
    noticeHash: string;
    agreedAt: Date;
    action: "checkbox";
    withdrawnAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  /** Set by an admin: the account cannot sign in and every session it had is revoked. */
  disabledAt?: Date;
}

/**
 * What an admin did to a vendor's account (NFR-S2). Reading someone's profile is itself recorded,
 * because personal data is involved, and so is every change and every email sent on their behalf.
 */
export interface AdminAuditDocument {
  accountId: string;
  action:
    | "viewed"
    | "profile-edited"
    | "role-changed"
    | "disabled"
    | "enabled"
    | "verification-email-sent"
    | "password-reset-sent"
    | "match-email-sent";
  actor: string;
  at: Date;
  detail?: string;
}

export interface SessionDocument {
  _id: string;
  accountId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
}

export type AccountTokenPurpose = "verify" | "reset";

export interface AccountTokenDocument {
  tokenHash: string;
  accountId: string;
  purpose: AccountTokenPurpose;
  expiresAt: Date;
}

/** A saved TOR belongs to one vendor and is removed with that vendor. */
export interface BookmarkDocument {
  accountId: string;
  torId: string;
  createdAt: Date;
}

/** The three explicit preferences used to explain vendor-facing relevance. */
/** A vendor's stated wish for how often and how closely to be emailed. */
export interface NotifyPreferences {
  preset: "all" | "daily" | "high" | "off";
  minMatch: number;
  leadDays: number;
  deadlineReminder: boolean;
  anomalyAlert: boolean;
}

export interface VendorProfileDocument {
  accountId: string;
  categories: string[];
  areas: string[];
  /**
   * Work the taxonomy has no node for, as the vendor wrote it. Deliberately
   * separate from `categories`: these are NOT matched against, because free
   * text is what the taxonomy exists to replace. They are the record of what
   * the vocabulary is missing. Optional, so profiles written before the field
   * existed still read.
   */
  otherCategories?: string[];
  budget: { minThb: number; maxThb: number } | null;
  /** Optional, so profiles written before the field existed still read. */
  notify?: NotifyPreferences;
  taxonomyVersion: string;
  updatedAt: Date;
  /** Who made the last change. "admin" is shown to the vendor, so a staff edit is never passed off as theirs. */
  updatedBy?: "vendor" | "admin";
  /** Work the vendor has done. Optional, and saved on its own, so the main profile form never overwrites it. */
  pastProjects?: PastProject[];
  /**
   * What the vendor holds. Absent until the vendor first saves the section —
   * "not stated" is different from "holds nothing", and only a stated answer
   * may lower a score.
   */
  certifications?: VendorCertifications;
}

export interface PastProject {
  id: string;
  title: string;
  /** Buddhist-era year as Thai documents state it, e.g. 2567. */
  year: number | null;
  valueThb: number | null;
}

export interface VendorCertifications {
  /** grade (ชั้น 1-5) is optional and not asked yet: matching does not use it. */
  cgd: Array<{ branch: string; grade?: number }>;
  tags: string[];
  other: string[];
}

/** Durable audit/deduplication row for one vendor, TOR and notification reason. */
export interface NotificationDocument {
  accountId: string;
  torId: string;
  reason: "match" | "deadline-reminder" | "daily-digest";
  /** A dry-run is deliberately distinct: it must never suppress a later real send. */
  dryRun: boolean;
  period?: string;
  createdAt: Date;
  sentAt?: Date;
  messageId?: string;
}

/** Singleton lease so two worker processes do not dispatch the same batch. */
export interface NotificationLeaseDocument {
  _id: "notify-dispatch";
  owner: string;
  leaseUntil: Date;
}

/** Cached derived data; source TOR documents remain immutable after extraction. */
/**
 * One person's judgement of one vendor–TOR pair: the labelled benchmark design
 * §7.8 requires before match emails ship. The score and whether the system
 * counted it a match are frozen at labelling time, so the figures describe
 * what the vendor would actually have been sent.
 */
export interface MatchLabelDocument {
  accountId: string;
  torId: string;
  label: "relevant" | "not-relevant" | "unsure";
  /** Score in [0, 1] when labelled. */
  score: number;
  /** Whether that score met the vendor's own email threshold then. */
  matched: boolean;
  labelledBy: string;
  labelledAt: Date;
}

export interface TorClassificationDocument {
  torId: string;
  classification: TorClassification;
  mapperVersion: string;
  updatedAt: Date;
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

export function accounts(db: Db): Collection<AccountDocument> {
  return db.collection<AccountDocument>("accounts");
}

export function sessions(db: Db): Collection<SessionDocument> {
  return db.collection<SessionDocument>("sessions");
}

export function accountTokens(db: Db): Collection<AccountTokenDocument> {
  return db.collection<AccountTokenDocument>("auth_tokens");
}

export function bookmarks(db: Db): Collection<BookmarkDocument> {
  return db.collection<BookmarkDocument>("bookmarks");
}

export function adminAudit(db: Db): Collection<AdminAuditDocument> {
  return db.collection<AdminAuditDocument>("admin_audit");
}

export function vendorProfiles(db: Db): Collection<VendorProfileDocument> {
  return db.collection<VendorProfileDocument>("vendor_profiles");
}

export function torClassifications(db: Db): Collection<TorClassificationDocument> {
  return db.collection<TorClassificationDocument>("tor_classifications");
}

export function matchLabels(db: Db): Collection<MatchLabelDocument> {
  return db.collection<MatchLabelDocument>("match_labels");
}

export function notifications(db: Db): Collection<NotificationDocument> {
  return db.collection<NotificationDocument>("notifications");
}

export function notificationLeases(db: Db): Collection<NotificationLeaseDocument> {
  return db.collection<NotificationLeaseDocument>("notification_leases");
}

/** Indexes from spec section 4.5. The unique contentHash index is the dedupe guarantee. */
export async function ensureIndexes(db: Db): Promise<void> {
  // A deleted account overwrites its address with a random tombstone, so an
  // ordinary unique index both permits re-registration and retains no address.
  await accounts(db).createIndex({ email: 1 }, { unique: true });
  await sessions(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await sessions(db).createIndex({ accountId: 1 });
  await accountTokens(db).createIndex({ tokenHash: 1 }, { unique: true });
  await accountTokens(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await bookmarks(db).createIndex({ accountId: 1, torId: 1 }, { unique: true });
  await vendorProfiles(db).createIndex({ accountId: 1 }, { unique: true });
  // dryRun participates in the key so benchmark-safe previews cannot suppress
  // the eventual live email. `reason` distinguishes a match from its reminder.
  await notifications(db).createIndex({ accountId: 1, torId: 1, reason: 1, dryRun: 1 }, { unique: true });
  await notifications(db).createIndex({ accountId: 1, reason: 1, period: 1 });
  await torClassifications(db).createIndex({ torId: 1 }, { unique: true });
  // One judgement per pair; relabelling replaces it.
  await matchLabels(db).createIndex({ accountId: 1, torId: 1 }, { unique: true });
  await torClassifications(db).createIndex({ "classification.coarse": 1, updatedAt: -1 });
  // Precise candidates — records with leaf evidence for what a vendor chose —
  // are read before the coarse ones, so they need their own path.
  await torClassifications(db).createIndex({ "classification.leaves.id": 1, updatedAt: -1 });
  await adminAudit(db).createIndex({ accountId: 1, at: -1 });
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
