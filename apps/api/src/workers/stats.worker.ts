import { pathToFileURL } from "node:url";
import { loadConfig } from "../core/config.js";
import { loadEnvFile } from "../core/env-file.js";
import { connect, ensureIndexes } from "../core/db.js";
import { StatsService } from "../modules/stats/stats.service.js";

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** The dashboard cache worker is independent of extraction so stalled OCR cannot stall freshness. */
export async function startStatsWorker(config: ReturnType<typeof loadConfig>): Promise<void> {
  const db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  const service = new StatsService(db, config);
  console.log(JSON.stringify({ event: "stats_worker_started", sweepIntervalMs: config.stats.sweepIntervalMs }));

  // Two cadences, deliberately different. Dirty cohorts are drained at the
  // queue poll interval, because freshness after an edit is what a reviewer
  // sees. The full sweep is the safety net for a mark that never arrived, and
  // recomputes every cohort, so it runs on its own much longer interval —
  // sleeping a whole sweep interval between claims would make every correction
  // take minutes to reach the dashboard.
  let lastSweep = 0;

  for (;;) {
    try {
      if (await service.recomputeOne()) continue;

      if (Date.now() - lastSweep >= config.stats.sweepIntervalMs) {
        lastSweep = Date.now();
        const swept = await service.sweepEveryCohort();
        if (swept > 0) console.log(JSON.stringify({ event: "stats_swept", cohorts: swept }));
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "stats_failed", message: error instanceof Error ? error.message : "unknown" }));
    }
    await pause(config.jobPollMs);
  }
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  loadEnvFile();
  startStatsWorker(loadConfig(process.env)).catch((error: Error) => {
    console.error(JSON.stringify({ event: "stats_worker_crashed", message: error.message }));
    process.exit(1);
  });
}
