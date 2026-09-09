import { ObjectId, type Db } from "mongodb";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../core/config.js";
import { connect, ensureIndexes, tors } from "../core/db.js";
import { MongoQueue } from "../adapters/mongo.queue.js";
import type { Queue } from "../ports/queue.port.js";
import { reconcileOrphanedRecords } from "./reconcile.js";

/**
 * The seam slice 2 fills. Given a TOR id it reads the stored document, runs
 * OCR and field extraction, and writes `fields`, `confidenceLevel`, and
 * `provenance` back onto the record. It does NOT own the pipeline state: the
 * worker moves the record to `published` on success and `failed` once retries
 * are exhausted, because §4.2.1 publishes every readable record regardless of
 * confidence.
 */
export type ExtractionHandler = (torId: string) => Promise<void>;

/**
 * Slice 1 ships this pass-through so the seam - intake enqueues, the worker
 * claims, the record reaches `published` - is exercised end to end before
 * Vertex AI is wired. TOR-89 replaces the body; nothing around it changes.
 */
export const passThroughHandler: ExtractionHandler = async () => {};

export interface RunOnceDeps {
  queue: Queue;
  handle: ExtractionHandler;
  onExtracting: (torId: string) => Promise<void>;
  onPublished: (torId: string) => Promise<void>;
  onFailed: (torId: string, reason: string) => Promise<void>;
}

export type RunOnceResult = "idle" | "published" | "retry" | "failed";

/**
 * One claim-handle-resolve cycle. Pure orchestration over the injected ports,
 * so the state machine is unit-tested without a database or a real model.
 */
export async function runOnce(deps: RunOnceDeps): Promise<RunOnceResult> {
  const job = await deps.queue.claim();
  if (!job) return "idle";

  try {
    await deps.onExtracting(job.torId);
    await deps.handle(job.torId);
    await deps.onPublished(job.torId);
    await deps.queue.complete(job.id);
    return "published";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    const { willRetry } = await deps.queue.fail(job.id, reason);
    if (willRetry) return "retry";
    // NFR-S5: the raw document stays in storage; the reason is recorded; the
    // record is not silently dropped and never publishes as if complete.
    await deps.onFailed(job.torId, reason);
    return "failed";
  }
}

// --- state transitions on the tors record (the worker owns pipeline.state) ---

function setPipelineState(db: Db, torId: string, patch: Record<string, unknown>) {
  return tors(db).updateOne(
    { _id: new ObjectId(torId) },
    { $set: { ...patch, updatedAt: new Date() } },
  );
}

export function torTransitions(db: Db): Omit<RunOnceDeps, "queue" | "handle"> {
  return {
    onExtracting: async (torId) => {
      await setPipelineState(db, torId, { "pipeline.state": "extracting" });
    },
    onPublished: async (torId) => {
      await setPipelineState(db, torId, { "pipeline.state": "published" });
    },
    onFailed: async (torId, reason) => {
      await setPipelineState(db, torId, {
        "pipeline.state": "failed",
        "pipeline.failedReason": reason,
      });
    },
  };
}

/**
 * The long-running loop: poll for jobs, and on a schedule sweep for records
 * whose enqueue never landed.
 */
export async function startWorker(
  config: ReturnType<typeof loadConfig>,
  handle: ExtractionHandler = passThroughHandler,
): Promise<void> {
  const db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  const queue = new MongoQueue(db, {
    maxAttempts: config.jobMaxAttempts,
    backoffMs: config.jobBackoffMs,
    lockMs: config.jobLockMs,
  });
  const deps: RunOnceDeps = { queue, handle, ...torTransitions(db) };

  let lastReconcile = 0;
  console.log(JSON.stringify({ event: "worker_started", pollMs: config.jobPollMs }));

  for (;;) {
    if (Date.now() - lastReconcile > config.reconcileIntervalMs) {
      const requeued = await reconcileOrphanedRecords(db, queue, config.reconcileMinAgeMs);
      if (requeued > 0) console.log(JSON.stringify({ event: "reconciled", requeued }));
      lastReconcile = Date.now();
    }

    const result = await runOnce(deps);
    if (result === "idle") {
      await new Promise((resolve) => setTimeout(resolve, config.jobPollMs));
    } else {
      console.log(JSON.stringify({ event: "job_" + result }));
    }
  }
}

const isEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
  startWorker(loadConfig(process.env)).catch((error: Error) => {
    console.error(JSON.stringify({ event: "worker_crashed", message: error.message }));
    process.exit(1);
  });
}
