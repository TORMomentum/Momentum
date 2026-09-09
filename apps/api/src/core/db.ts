import { MongoClient, type Collection, type Db } from "mongodb";

export interface TorDocument {
  contentHash: string;
  storage: { bucket: string; key: string; contentType: string; bytes: number };
  sourceRefs: Array<{ route: string; url?: string; submittedBy: string; submittedAt: Date }>;
  pipeline: { state: string; attempts: number; failedReason?: string };
  fields: Record<string, unknown>;
  /** The TOR's own publication date, extracted in slice 2 - never the ingestion time. */
  announcedAt: Date | null;
  sourceUrl: string | null;
  confidenceLevel?: string;
  unverified: boolean;
  statusHistory: Array<{ from: string | null; to: string; at: Date; actor: string; source: string }>;
  access: { restricted: boolean; reason?: string; auditRef?: string };
  duplicateOf: string | null;
  createdAt: Date;
  updatedAt: Date;
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

/** Indexes from spec section 4.5. The unique contentHash index is the dedupe guarantee. */
export async function ensureIndexes(db: Db): Promise<void> {
  await tors(db).createIndex({ contentHash: 1 }, { unique: true });
  await tors(db).createIndex({ "pipeline.state": 1, createdAt: -1 });
  // Aggregations and peer groups select on the AGENCY's date, so these index
  // announcedAt rather than ingestion time. The agency + announcedAt pair is
  // served by the three-field compound below, whose prefix covers it - one
  // index, not two, because every extra index is paid for on every write.
  await tors(db).createIndex({ "fields.category.value": 1, announcedAt: -1 });
  await tors(db).createIndex({ announcedAt: -1 });
  await tors(db).createIndex({
    "fields.agency.value": 1,
    announcedAt: -1,
    "fields.torStatus.value": 1,
  });
  await tors(db).createIndex({ "access.restricted": 1 });
  await jobs(db).createIndex({ state: 1, nextRunAt: 1 });
  await jobs(db).createIndex({ torId: 1, state: 1 });
}
