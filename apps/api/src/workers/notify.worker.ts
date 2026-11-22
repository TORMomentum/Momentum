import { pathToFileURL } from "node:url";
import { createMailer } from "../adapters/mailer.factory.js";
import { loadConfig, type Config } from "../core/config.js";
import { connect, disconnect, ensureIndexes } from "../core/db.js";
import { loadEnvFile } from "../core/env-file.js";
import { NotifyService } from "../modules/notifications/notify.service.js";
import { configureLogger, logger } from "../core/logger.js";
import { installProcessErrorHandlers } from "../core/process-errors.js";

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** The §7.8 benchmark gate is enforced by NotifyService/config, not by stopping this verifier worker. */
export async function startNotifyWorker(config: Config): Promise<void> {
  configureLogger(config.logLevel);
  const db = await connect(config.mongoUrl); await ensureIndexes(db);
  const service = new NotifyService(db, config, createMailer(config));
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  logger.info("notify_worker_started", { intervalMs: config.notifications.dispatchIntervalMs, enabled: config.notifications.dispatchEnabled });
  while (!stopping) {
    try { logger.info("notify_dispatch_completed", { ...await service.dispatch() }); }
    catch (error) { logger.error("notify_dispatch_failed", { error: error instanceof Error ? error.message : "unknown" }); }
    if (!stopping) await pause(config.notifications.dispatchIntervalMs);
  }
  await disconnect();
  logger.info("notify_worker_stopped");
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) { installProcessErrorHandlers(); loadEnvFile(); startNotifyWorker(loadConfig(process.env)).catch((error: Error) => { logger.error("notify_worker_crashed", { error: error.message }); process.exit(1); }); }
