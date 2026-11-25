import { pathToFileURL } from "node:url";
import { NationalEgpCollect } from "../adapters/national-egp.collect.js";
import { MongoQueue } from "../adapters/mongo.queue.js";
import { createStorage } from "../adapters/storage.factory.js";
import { loadConfig } from "../core/config.js";
import { connect, ensureIndexes } from "../core/db.js";
import { loadEnvFile } from "../core/env-file.js";
import { configureLogger, logger } from "../core/logger.js";
import { installProcessErrorHandlers } from "../core/process-errors.js";
import { CollectorRepository } from "../modules/collector/collector.repository.js";
import { CollectorService, partOutcome } from "../modules/collector/collector.service.js";
import { IntakeRepository } from "../modules/intake/intake.repository.js";
import { IntakeService } from "../modules/intake/intake.service.js";
import { SourceHealthRepository } from "../modules/sources/source-health.repository.js";
import { SourceHealthService } from "../modules/sources/source-health.service.js";
import { NATIONAL_EGP_AWARDS_ID, NATIONAL_EGP_IMPORT_ID } from "../modules/sources/sources.registry.js";

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Collects national e-GP TORs, invitations and winner announcements on a schedule (F12, spec
 * 2026-11-25-scheduled-collector). Its own process, like the stages worker: it only queues, and the
 * extraction worker reads what it queues.
 */
export async function startCollectorWorker(config: ReturnType<typeof loadConfig>): Promise<void> {
  configureLogger(config.logLevel);
  if (!config.collector.enabled) {
    // Decision 9: billed extraction is switched on deliberately, so an unset flag is a stop, not a default run.
    logger.info("collector_disabled", { reason: "COLLECTOR_ENABLED is not true" });
    return;
  }
  const db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  // Wiring happens here, once: the module sees the port, never the adapter.
  const storage = createStorage(config, "worker");
  const service = new CollectorService({
    source: new NationalEgpCollect(config.search.timeZone),
    repo: new CollectorRepository(db),
    intake: new IntakeService(
      storage,
      new MongoQueue(db, { maxAttempts: config.jobMaxAttempts, backoffMs: config.jobBackoffMs, lockMs: config.jobLockMs }),
      new IntakeRepository(db),
      { allowedMimeTypes: config.allowedMimeTypes, maxUploadBytes: config.maxUploadBytes },
      // As the intake routes do, so each record joins its dashboard cohort at intake.
      { timezone: config.stats.timezone },
    ),
    storage,
    config,
  });
  const health = new SourceHealthService({ repo: new SourceHealthRepository(db), config });
  // Health is reported, never relied on: a failed write is logged and the worker goes on (TOR-87).
  const report = async (id: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      logger.error("source_health_write_failed", { source: id, error: error instanceof Error ? error.message : "unknown" });
    }
  };
  logger.info("collector_worker_started", {
    intervalMs: config.collector.intervalMs,
    listPages: config.collector.listPages,
    maxNewPerDay: config.collector.maxNewPerDay,
  });

  for (;;) {
    let wait = config.collector.intervalMs;
    try {
      const pass = await service.runPass();
      logger.info("collector_pass", { tors: pass.tors, awards: pass.awards, backOff: pass.backOff, remaining: pass.remaining });
      for (const [id, part] of [[NATIONAL_EGP_IMPORT_ID, pass.tors], [NATIONAL_EGP_AWARDS_ID, pass.awards]] as const) {
        const outcome = partOutcome(part);
        // Asked e-GP nothing (the ceiling was spent): alive, which is a heartbeat, not a success.
        await report(id, () => (outcome ? health.recordRun(id, outcome) : health.heartbeat(id)));
      }
      if (pass.backOff) {
        // e-GP is refusing: wait, rather than add to it.
        logger.warn("collector_backing_off", { backoffMs: config.collector.backoffMs });
        wait = Math.max(wait, config.collector.backoffMs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      logger.error("collector_failed", { error: message });
      for (const id of [NATIONAL_EGP_IMPORT_ID, NATIONAL_EGP_AWARDS_ID]) {
        await report(id, () => health.recordRun(id, { ok: false, items: 0, failed: 0, error: message }));
      }
    }
    await pause(wait);
  }
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  installProcessErrorHandlers();
  loadEnvFile();
  startCollectorWorker(loadConfig(process.env)).catch((error: Error) => {
    logger.error("collector_worker_crashed", { error: error.message });
    process.exit(1);
  });
}
