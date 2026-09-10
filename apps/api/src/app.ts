import express, { type Express } from "express";
import type { Db } from "mongodb";
import { sourcesRouter } from "./routes/sources";
import { type Config } from "./core/config.js";
import { errorMiddleware } from "./core/errors.js";
import { MinioStorage } from "./adapters/minio.storage.js";
import { MongoQueue } from "./adapters/mongo.queue.js";
import { IntakeRepository } from "./modules/intake/intake.repository.js";
import { IntakeService } from "./modules/intake/intake.service.js";
import { buildIntakeRouter } from "./modules/intake/intake.routes.js";
import { HistoryRepository } from "./modules/history/history.repository.js";
import { AdminRepository } from "./modules/admin/admin.repository.js";
import { AdminService } from "./modules/admin/admin.service.js";
import { buildAdminRouter } from "./modules/admin/admin.routes.js";

/** Every route lives under one version prefix — see docs/API.md §1. */
export const API_PREFIX = "/api/v1";

/**
 * The one place adapters are named. Modules depend on ports; this function
 * decides which implementation satisfies them, which is what keeps the feature
 * modules testable with fakes.
 */
export function buildApp(config: Config, db: Db): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "tor-radar-api" });
  });

  // Read-only view of the BMA eGP source system (docs/DATA-SOURCES.md).
  app.use("/sources", sourcesRouter);

  const service = new IntakeService(
    new MinioStorage(config.minio),
    new MongoQueue(db, {
      maxAttempts: config.jobMaxAttempts,
      backoffMs: config.jobBackoffMs,
      lockMs: config.jobLockMs,
    }),
    new IntakeRepository(db),
    { allowedMimeTypes: config.allowedMimeTypes, maxUploadBytes: config.maxUploadBytes },
  );

  app.use(
    `${API_PREFIX}/intake`,
    buildIntakeRouter({
      service,
      adminKeys: config.adminApiKeys,
      intakeKeys: config.intakeApiKeys,
      maxUploadBytes: config.maxUploadBytes,
      multipartMaxFiles: config.multipartMaxFiles,
      multipartMaxFieldBytes: config.multipartMaxFieldBytes,
      fetchLimits: {
        timeoutMs: config.fetchTimeoutMs,
        maxRedirects: config.fetchMaxRedirects,
        maxBytes: config.fetchMaxBytes,
      },
      rateLimitPerMinute: config.intakeRateLimit,
    }),
  );

  const queue = new MongoQueue(db, {
    maxAttempts: config.jobMaxAttempts,
    backoffMs: config.jobBackoffMs,
    lockMs: config.jobLockMs,
  });

  app.use(
    `${API_PREFIX}/admin`,
    buildAdminRouter({
      service: new AdminService({
        repo: new AdminRepository(db),
        history: new HistoryRepository(db),
        queue,
      }),
      adminKeys: config.adminApiKeys,
      queuePageSize: config.adminQueuePageSize,
    }),
  );

  // Last: it only sees what the routes above throw.
  app.use(errorMiddleware);

  return app;
}

/**
 * A minimal app for the liveness probe alone, used by CI and by anything that
 * needs the process up without a database. It deliberately serves no data
 * routes: an API that answers /health while its real routes are missing is
 * worse than one that fails to start.
 */
export const app = express();
app.use(express.json());
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "tor-radar-api" });
});
app.use("/sources", sourcesRouter);
