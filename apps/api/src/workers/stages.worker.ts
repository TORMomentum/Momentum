import { pathToFileURL } from "node:url";
import { NationalEgpStages } from "../adapters/national-egp.stages.js";
import { loadConfig } from "../core/config.js";
import { loadEnvFile } from "../core/env-file.js";
import { connect, ensureIndexes } from "../core/db.js";
import { configureLogger, logger } from "../core/logger.js";
import { installProcessErrorHandlers } from "../core/process-errors.js";
import { StagesRepository } from "../modules/stages/stages.repository.js";
import { StagesService } from "../modules/stages/stages.service.js";

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Keeps each e-GP project's published stages on its TOR records (TOR-205, spec 2026-11-23-project-stages).
 * Its own process, like the stats worker: a slow or refusing e-GP must never stall extraction.
 */
export async function startStagesWorker(config: ReturnType<typeof loadConfig>): Promise<void> {
  configureLogger(config.logLevel);
  const db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  // Wiring happens here, once: the module sees the port, never the adapter.
  const service = new StagesService({
    repo: new StagesRepository(db),
    source: new NationalEgpStages(config.search.timeZone),
    config,
  });
  const seeded = await service.seed();
  logger.info("stages_worker_started", { seeded, refreshMs: config.stages.refreshMs, requestDelayMs: config.stages.requestDelayMs });

  for (;;) {
    try {
      const pass = await service.runPass();
      if (pass.projects > 0) logger.info("stages_pass", { ...pass });
      if (pass.backOff) {
        // e-GP is refusing (429 under load): wait, rather than add to it.
        logger.warn("stages_backing_off", { backoffMs: config.stages.backoffMs });
        await pause(config.stages.backoffMs);
        continue;
      }
      if (pass.projects === 0) {
        // Nothing was due: give records imported since the last look a due time, then wait a poll interval.
        const seededNow = await service.seed();
        if (seededNow > 0) logger.info("stages_seeded", { records: seededNow });
        else await pause(config.jobPollMs);
      }
    } catch (error) {
      logger.error("stages_failed", { error: error instanceof Error ? error.message : "unknown" });
      await pause(config.jobPollMs);
    }
  }
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  installProcessErrorHandlers();
  loadEnvFile();
  startStagesWorker(loadConfig(process.env)).catch((error: Error) => {
    logger.error("stages_worker_crashed", { error: error.message });
    process.exit(1);
  });
}
