import express, { type Express } from "express";
import type { Db } from "mongodb";
import { sourcesRouter } from "./routes/sources";
import { type Config } from "./core/config.js";
import { errorMiddleware } from "./core/errors.js";
import { sessionContext } from "./core/session-context.js";
import { createStorage } from "./adapters/storage.factory.js";
import { createMailer } from "./adapters/mailer.factory.js";
import { MongoQueue } from "./adapters/mongo.queue.js";
import { IntakeRepository } from "./modules/intake/intake.repository.js";
import { IntakeService } from "./modules/intake/intake.service.js";
import { buildIntakeRouter } from "./modules/intake/intake.routes.js";
import { HistoryRepository } from "./modules/history/history.repository.js";
import { AdminRepository } from "./modules/admin/admin.repository.js";
import { AdminService } from "./modules/admin/admin.service.js";
import { buildAdminRouter } from "./modules/admin/admin.routes.js";
import { buildAdminAccountsRouter } from "./modules/admin/admin-accounts.routes.js";
import { AdminAccountsRepository } from "./modules/admin/admin-accounts.repository.js";
import { AdminAccountsService } from "./modules/admin/admin-accounts.service.js";
import { NotifyService } from "./modules/notifications/notify.service.js";
import { MatchLabelsRepository } from "./modules/match-quality/match-labels.repository.js";
import { buildMatchQualityRouter } from "./modules/match-quality/match-quality.routes.js";
import { MatchQualityService } from "./modules/match-quality/match-quality.service.js";
import { TorsRepository } from "./modules/tors/tors.repository.js";
import { TorsService } from "./modules/tors/tors.service.js";
import { buildTorsRouter } from "./modules/tors/tors.routes.js";
import { StatsRepository } from "./modules/stats/stats.repository.js";
import { buildStatsRouter } from "./modules/stats/stats.routes.js";
import { SessionsRepository } from "./modules/accounts/sessions.js";
import { AccountsRepository } from "./modules/accounts/accounts.repository.js";
import { AccountTokensRepository } from "./modules/accounts/account-tokens.repository.js";
import { buildAccountsRouter } from "./modules/accounts/accounts.routes.js";
import { ProfileRepository } from "./modules/profile/profile.repository.js";
import { buildProfileRouter } from "./modules/profile/profile.routes.js";
import { BookmarksRepository } from "./modules/bookmarks/bookmarks.repository.js";
import { buildBookmarksRouter } from "./modules/bookmarks/bookmarks.routes.js";
import { MatchingRepository } from "./modules/matching/matching.repository.js";
import { buildMatchingRouter } from "./modules/matching/matching.routes.js";

/** Every route lives under one version prefix — see docs/API.md §1. */
export const API_PREFIX = "/api/v1";

/**
 * The one place adapters are named. Modules depend on ports; this function
 * decides which implementation satisfies them, which is what keeps the feature
 * modules testable with fakes.
 */
export function buildApp(config: Config, db: Db): Express {
  const app = express();
  const storage = createStorage(config, "api");
  // Feature services receive this port as they gain outbound email behaviour.
  // Constructing it here makes a production SMTP omission fail during startup.
  const mailer = createMailer(config);
  const sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs);
  const statsRepository = new StatsRepository(db);

  app.use(express.json());
  app.use(sessionContext(sessionsRepository));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "tor-radar-api" });
  });

  // Read-only view of the BMA eGP source system (docs/DATA-SOURCES.md).
  app.use("/sources", sourcesRouter);
  const accountsRepository = new AccountsRepository(db, sessionsRepository);
  const tokensRepository = new AccountTokensRepository(db);
  const profileRepository = new ProfileRepository(db);
  const accountsRouter = buildAccountsRouter({
    config, accounts: accountsRepository, tokens: tokensRepository,
    sessions: sessionsRepository, mailer,
  });
  // Mounted twice on purpose. The browser reaches the signed-in account's own
  // routes through the Next handler that owns the cookie, which forwards under
  // /auth; everything else addresses the versioned API. Mounting the profile
  // under only one of them made the profile screen ask for a path that did not
  // exist, which no API-level test could see.
  const profileRouter = buildProfileRouter({ config, profiles: profileRepository });
  const bookmarksRouter = buildBookmarksRouter({ config, bookmarks: new BookmarksRepository(db), tors: new TorsRepository(db) });
  const matchingRouter = buildMatchingRouter({ config, profiles: profileRepository, matching: new MatchingRepository(db, config) });
  for (const prefix of ["/auth", API_PREFIX]) {
    app.use(prefix, accountsRouter);
    app.use(prefix, profileRouter);
    app.use(prefix, bookmarksRouter);
    app.use(prefix, matchingRouter);
  }

  const service = new IntakeService(
    storage,
    new MongoQueue(db, {
      maxAttempts: config.jobMaxAttempts,
      backoffMs: config.jobBackoffMs,
      lockMs: config.jobLockMs,
    }),
    new IntakeRepository(db),
    { allowedMimeTypes: config.allowedMimeTypes, maxUploadBytes: config.maxUploadBytes },
    { timezone: config.stats.timezone },
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
        repo: new AdminRepository(db, config.budgetMaxThb, config.adminStuckAfterMs),
        history: new HistoryRepository(db),
        queue,
        tLow: config.tLow,
        budgetMaxThb: config.budgetMaxThb,
        stats: {
          markCohortsDirty: statsRepository.markCohortsDirty.bind(statsRepository),
          windowMonths: config.stats.peerWindowMonths,
          timezone: config.stats.timezone,
        },
      }),
      storage,
      adminKeys: config.adminApiKeys,
      queuePageSize: config.adminQueuePageSize,
      bulkMax: config.adminBulkMax,
    }),
  );

  app.use(
    `${API_PREFIX}/admin`,
    buildAdminAccountsRouter({
      service: new AdminAccountsService({
        repo: new AdminAccountsRepository(db),
        accounts: accountsRepository,
        profiles: profileRepository,
        sessions: sessionsRepository,
        tokens: tokensRepository,
        mailer,
        appOrigin: config.appOrigin,
        verifyTokenTtlMs: config.verifyTokenTtlMs,
        resetTokenTtlMs: config.resetTokenTtlMs,
        matchEmails: new NotifyService(db, config, mailer),
      }),
      adminKeys: config.adminApiKeys,
      pageSize: config.adminQueuePageSize,
    }),
  );

  // The match-quality benchmark (design §7.8): labels and the figures from them.
  app.use(
    `${API_PREFIX}/admin`,
    buildMatchQualityRouter({
      service: new MatchQualityService({
        config,
        profiles: profileRepository,
        matching: new MatchingRepository(db, config),
        labels: new MatchLabelsRepository(db),
      }),
      adminKeys: config.adminApiKeys,
    }),
  );

  app.use(
    `${API_PREFIX}/tors`,
    buildTorsRouter({
      service: new TorsService({ repo: new TorsRepository(db), config }),
      storage,
      search: config.search,
      config,
      profiles: profileRepository,
      matching: new MatchingRepository(db, config),
    }),
  );

  app.use(`${API_PREFIX}/stats`, buildStatsRouter({ db, config }));

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
