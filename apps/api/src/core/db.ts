import { MongoClient, MongoServerError, ObjectId, type Collection, type Db } from "mongodb";
import type { ConfidenceLevel, DocumentType, Provenance, SourceProject, TorFields, StoredAnnex } from "@tor-radar/shared";
import type { CohortKey } from "../modules/stats/cohort.js";
import { eligibleFilter } from "../modules/stats/eligibility.js";
import type { TorClassification } from "../modules/matching/tor-classifier.js";

/** A text's meaning as numbers, with the model that produced them so models are never mixed (TOR-202). */
export interface StoredEmbedding {
  model: string;
  vector: number[];
}

export interface TorDocument {
  contentHash: string;
  /** Title and scope summary, embedded at extraction; absent while embeddings are off. */
  embedding?: StoredEmbedding;
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
  /**
   * A second, separate consent (TOR-215): recording what the vendor views, saves, dismisses and prepares, to
   * personalise their score. Absent or withdrawn means no event is recorded and none is read.
   */
  behaviourConsent?: { agreedAt: Date; withdrawnAt?: Date };
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  /** Set while the account is being deleted: nothing new may be kept for it, and a failed deletion clears it. */
  deletingAt?: Date;
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
  /** `otherCategories` entries embedded when the profile was saved; one whose text no longer matches is ignored. */
  otherCategoryVectors?: Array<StoredEmbedding & { text: string }>;
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
  /**
   * The people the company can put on a job, by role and what each holds (TOR-212). No names: matching needs
   * the role and the certificates, and a name would be personal data about a third party for no gain.
   * Absent until the vendor states it; saved with the other extras, so export and delete cover it with the profile.
   */
  personnel?: PersonnelMember[];
}

export interface PersonnelMember {
  id: string;
  /** As the vendor writes it, e.g. "วิศวกรโยธา". */
  role: string;
  /** Listed certifications (packages/seeds CERTIFICATIONS) this person holds. */
  certifications: string[];
  /** Anything else the person holds, in the vendor's words. */
  other: string[];
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

/** Cached derived data; source TOR documents remain immutable after extraction. */
export type BehaviourEventType = "view" | "save" | "dismiss" | "prepare";

/** One thing a consenting vendor did to a TOR (TOR-215). Kept for the scoring window, in the export, and deleted with the account. */
export const VAULT_KINDS = ["cv", "certificate", "past_work"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

/**
 * One file a vendor keeps for reuse (TOR-218). The bytes live in the vault bucket under `key`; this is only
 * what the screen lists and what a later readiness check matches against. `certificationId` is the vendor's
 * own statement of which certificate a file is (from the certification list), never something read off it.
 *
 * The record exists BEFORE the bytes do. An upload first takes a `slot` and writes this row as `pending`, with
 * the key it is about to write, so that whatever happens next (a crash, a failed rollback, the account being
 * deleted mid-upload) there is a row that names the file and can be cleaned up. It becomes `ready` once the
 * bytes are stored; `discarded` marks one whose upload must not complete. `slot` is unique per account, which is
 * what makes the file cap hold under concurrent uploads: there are only `VAULT_MAX_FILES` slots to take.
 */
export interface VaultDocument {
  _id: ObjectId;
  accountId: string;
  slot: number;
  key: string;
  status: "pending" | "ready" | "discarded";
  /** When the row was created; a pending row's age is how a stuck upload is told from a running one. */
  uploadedAt: Date;
  kind?: VaultKind;
  certificationId?: string;
  filename?: string;
  contentType?: string;
  bytes?: number;
  sha256?: string;
}

/** A stored, listed file: every field the screen needs is there. */
export type ReadyVaultDocument = VaultDocument & Required<Pick<VaultDocument, "kind" | "filename" | "contentType" | "bytes" | "sha256">>;

export interface BehaviourEventDocument {
  accountId: string;
  torId: string;
  type: BehaviourEventType;
  at: Date;
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

export function vaultDocuments(db: Db): Collection<VaultDocument> {
  return db.collection<VaultDocument>("vault_documents");
}

export function behaviourEvents(db: Db): Collection<BehaviourEventDocument> {
  return db.collection<BehaviourEventDocument>("behaviour_events");
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

/** The text fields a keyword query reads: the extracted value and the text it was read from. */
export const SEARCH_PATHS = ["fields.title.raw", "fields.title.value", "fields.agency.raw", "fields.agency.value"] as const;

/**
 * The Atlas Search index behind keyword search (TOR-201). `lucene.thai` splits
 * Thai into words, which a regular index cannot. Created once and left alone:
 * it builds in the background, so a query right after creation may find nothing.
 */
export async function ensureSearchIndex(db: Db, name: string): Promise<void> {
  const existing = await tors(db).listSearchIndexes(name).toArray();
  if (existing.length > 0) return;
  // The mapping nests one level per path segment: a dotted key is not a path here.
  const fields: Record<string, unknown> = {};
  for (const path of SEARCH_PATHS) {
    let level = fields;
    const parts = path.split(".");
    for (const part of parts.slice(0, -1)) {
      level = ((level[part] ??= { type: "document", dynamic: false, fields: {} }) as { fields: Record<string, unknown> }).fields;
    }
    level[parts[parts.length - 1]] = { type: "string", analyzer: "lucene.thai" };
  }
  await tors(db).createSearchIndex({ name, definition: { mappings: { dynamic: false, fields } } });
}

/**
 * One event per (account, TOR, kind). Rows written before that rule can repeat, and a unique index cannot be
 * built over repeats, so on that one error the older copies are removed (the latest time is kept) and the
 * build is retried. Nothing runs on a collection that is already clean.
 */
async function createBehaviourEventKey(db: Db): Promise<void> {
  const key = { accountId: 1, torId: 1, type: 1 } as const;
  try {
    await behaviourEvents(db).createIndex(key, { unique: true });
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
    const repeated = behaviourEvents(db).aggregate<{ ids: ObjectId[]; keep: ObjectId }>([
      { $sort: { at: -1 } },
      { $group: { _id: { accountId: "$accountId", torId: "$torId", type: "$type" }, keep: { $first: "$_id" }, ids: { $push: "$_id" } } },
      { $match: { "ids.1": { $exists: true } } },
    ]);
    for await (const group of repeated) {
      await behaviourEvents(db).deleteMany({ _id: { $in: group.ids.filter((id) => !id.equals(group.keep)) } });
    }
    await behaviourEvents(db).createIndex(key, { unique: true });
  }
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
  await behaviourEvents(db).createIndex({ accountId: 1, at: -1 });
  await createBehaviourEventKey(db);
  await vaultDocuments(db).createIndex({ accountId: 1, uploadedAt: -1 });
  // One row per slot: the file cap cannot be passed by uploads that start together.
  await vaultDocuments(db).createIndex({ accountId: 1, slot: 1 }, { unique: true });
  await vaultDocuments(db).createIndex({ status: 1, uploadedAt: 1 });
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
