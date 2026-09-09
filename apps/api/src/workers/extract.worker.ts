import { ObjectId, type Db } from "mongodb";
import { pathToFileURL } from "node:url";
import { loadConfig, type Config } from "../core/config.js";
import { connect, ensureIndexes, tors } from "../core/db.js";
import { MongoQueue } from "../adapters/mongo.queue.js";
import { MinioStorage } from "../adapters/minio.storage.js";
import { VertexAi } from "../adapters/vertex.ai.js";
import type { Queue } from "../ports/queue.port.js";
import { ExtractionRepository } from "../modules/extraction/extraction.repository.js";
import { ExtractionService } from "../modules/extraction/extraction.service.js";
import { reconcileOrphanedRecords } from "./reconcile.js";

/**
 * Given a TOR id, read the stored document, OCR + extract the nine fields,
 * grade the record (§4.2.1), and write it. It does NOT own the pipeline state:
 * the worker moves the record to `published` on success and `failed` once
 * retries are exhausted, because §4.2.1 publishes every readable record
 * regardless of confidence.
 */
export type ExtractionHandler = (torId: string) => Promise<void>;

/**
 * Does nothing and reports every record as published. Used by the seam tests
 * and by `--dry-run`, and as the fallback when no Vertex credential is
 * configured so the queue mechanics still run locally.
 */
export const passThroughHandler: ExtractionHandler = async () => {};

/** The real handler when a Vertex credential is present; the pass-through otherwise. */
export function buildHandler(config: Config, db: Db): ExtractionHandler {
  if (!config.vertex.project || !config.vertex.credentialsPath) {
    console.warn(JSON.stringify({ event: "extraction_disabled", reason: "no Vertex credential; using pass-through" }));
    return passThroughHandler;
  }
  const service = new ExtractionService({
    storage: new MinioStorage(config.minio),
    ai: new VertexAi(config.vertex),
    repo: new ExtractionRepository(db),
    config: {
      model: config.vertex.model,
      tLow: config.tLow,
      tHigh: config.tHigh,
      thresholdsVersion: config.thresholdsVersion,
      budgetMinThb: config.budgetMinThb,
      budgetMaxThb: config.budgetMaxThb,
    },
  });
  return service.run;
}

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
    // A terminal error (DocumentUnreadableError) fails the record now - retrying
    // an unreadable document just burns quota (spec §5.3, §9).
    if ((error as { retryable?: boolean }).retryable === false) {
      await deps.queue.abandon(job.id, reason);
      await deps.onFailed(job.torId, reason);
      return "failed";
    }
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
  config: Config,
  handle?: ExtractionHandler,
): Promise<void> {
  const db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  const queue = new MongoQueue(db, {
    maxAttempts: config.jobMaxAttempts,
    backoffMs: config.jobBackoffMs,
    lockMs: config.jobLockMs,
  });
  const deps: RunOnceDeps = { queue, handle: handle ?? buildHandler(config, db), ...torTransitions(db) };

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
