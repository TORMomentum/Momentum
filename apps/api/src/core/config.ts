import { z } from "zod";

/**
 * A `.env` file says "not set" by writing `KEY=`, which arrives as an empty
 * string rather than as an absent variable. Without this, every optional
 * setting would reject the very template the repository ships: `SMTP_URL=` in
 * `.env.example` stopped the API booting at all. Blank means absent, once,
 * for every optional value.
 */
function blankAsAbsent<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess((value) => {
    if (typeof value === "string" && value.trim() === "") return undefined;
    return value;
  }, inner.optional());
}

/**
 * Every threshold and tunable in the system (NFR-S7). Nothing below may appear
 * as a literal anywhere else in the codebase.
 */
const schema = z.object({
  MONGO_URL: z.string().min(1),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Outbound mail. Production must configure SMTP_URL (mailer.factory.ts).
  SMTP_URL: blankAsAbsent(z.string().url()),
  MAIL_FROM: z.string().min(1).default("TOR Radar <noreply@tor-radar.example>"),
  MAIL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Storage — Google Cloud Storage (spec §6)
  GCS_BUCKET: z.string().min(1),
  /** Set only for fake-gcs-server. Unset in deployment. */
  GCS_API_ENDPOINT: blankAsAbsent(z.url()),
  /**
   * The DEDICATED storage service account's key file. Deliberately not
   * GOOGLE_APPLICATION_CREDENTIALS: that is Vertex AI's identity, and the Google
   * client would silently adopt it if this were left to application-default
   * credentials — giving one compromised key both powers.
   */
  GCS_CREDENTIALS: blankAsAbsent(z.string().min(1)),
  STORAGE_TIMEOUT_API_MS: z.coerce.number().int().positive().default(10_000),
  STORAGE_TIMEOUT_WORKER_MS: z.coerce.number().int().positive().default(60_000),

  // Intake limits
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(26_214_400),
  ALLOWED_MIME_TYPES: z.string().default("application/pdf,image/jpeg,image/png"),
  MULTIPART_MAX_FILES: z.coerce.number().int().positive().default(1),
  MULTIPART_MAX_FIELD_BYTES: z.coerce.number().int().positive().default(8_192),
  INTAKE_RATE_LIMIT: z.coerce.number().int().positive().default(60),
  INTAKE_API_KEYS: z.string().min(1),
  ADMIN_API_KEYS: z.string().min(1),

  // Accounts and sessions (accounts and sessions design §5).
  SESSION_SECRET: z.string().min(32),
  APP_ORIGIN: z.url().refine((value) => new URL(value).origin === value, {
    message: "APP_ORIGIN must be an origin without a path",
  }),
  SESSION_LIFETIME_MS: z.coerce.number().int().positive().default(604_800_000),
  ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19_456),
  ARGON2_ITERATIONS: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),
  AUTH_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(60),
  AUTH_RATE_LIMIT_PER_EMAIL: z.coerce.number().int().positive().default(10),
  VERIFY_TOKEN_TTL_MS: z.coerce.number().int().positive().default(86_400_000),
  RESET_TOKEN_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  CONSENT_NOTICE_VERSION: z.string().min(1).default("2026-10-06"),
  CONSENT_NOTICE_HASH: z.string().min(1).default("notice-not-published"),

  // Outbound fetch, URL intake route
  FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  FETCH_MAX_REDIRECTS: z.coerce.number().int().nonnegative().default(3),
  FETCH_MAX_BYTES: z.coerce.number().int().positive().default(26_214_400),

  // Queue
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  JOB_BACKOFF_MS: z.coerce.number().int().positive().default(30_000),
  JOB_LOCK_MS: z.coerce.number().int().positive().default(120_000),
  JOB_POLL_MS: z.coerce.number().int().positive().default(2_000),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  RECONCILE_MIN_AGE_MS: z.coerce.number().int().positive().default(120_000),

  // Extraction (Slice 2). The credential is optional so the config loads in CI
  // and in tests that use a fake Ai; vertex.ai.ts checks it when actually called.
  GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash"),
  VERTEX_LOCATION: z.string().min(1).default("global"),
  GOOGLE_CLOUD_PROJECT: blankAsAbsent(z.string().min(1)),
  GOOGLE_APPLICATION_CREDENTIALS: blankAsAbsent(z.string().min(1)),
  EXTRACT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // Confidence thresholds — measured, not chosen (O1 closed; docs/corpus/BENCHMARK.md).
  T_LOW: z.coerce.number().min(0).max(1).default(0.8),
  T_HIGH: z.coerce.number().min(0).max(1).default(0.95),
  THRESHOLDS_VERSION: z.string().min(1).default("2026-09-03"),

  // Budget plausibility bounds for the §4.2.1 sanity check.
  BUDGET_MIN_THB: z.coerce.number().positive().default(10_000),
  BUDGET_MAX_THB: z.coerce.number().positive().default(100_000_000_000),

  // Statistics (Dashboard anomaly rule). ANOMALY_METHOD remains open value O4.
  PEER_GROUP_WINDOW_MONTHS: z.coerce.number().int().positive().default(12),
  PEER_MIN_N: z.coerce.number().int().positive().default(8),
  ANOMALY_METHOD: z.enum(["IQR", "ZSCORE"]).default("IQR"),
  // Fractional on purpose: the SRS fence is 1.5 x IQR. An int() schema here
  // still passes its own default (zod does not validate defaults) and then
  // rejects the identical value when it comes from the environment.
  ANOMALY_IQR_MULTIPLIER: z.coerce.number().positive().default(1.5),
  ANOMALY_ZSCORE_LIMIT: z.coerce.number().positive().default(3),
  STATS_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  STATS_LEASE_MS: z.coerce.number().int().positive().default(60_000),
  STATS_STALE_AFTER_MS: z.coerce.number().int().positive().default(3_600_000),
  COHORT_TIMEZONE: z.string().min(1).default("Asia/Bangkok"),

  /** How many review-queue rows one request returns (FR-G-1). */
  ADMIN_QUEUE_PAGE_SIZE: z.coerce.number().int().positive().max(200).default(25),

  // Public search (FR-E-3, NFR-F2). Ceilings bound what one request can ask the database for.
  SEARCH_PAGE_SIZE: z.coerce.number().int().positive().default(20),
  SEARCH_MAX_PAGE_SIZE: z.coerce.number().int().positive().max(500).default(100),
  SEARCH_QUERY_MAX_CHARS: z.coerce.number().int().positive().default(100),
  SEARCH_MAX_FILTER_VALUES: z.coerce.number().int().positive().default(20),
  SEARCH_FACET_LIMIT: z.coerce.number().int().positive().default(50),
  /** Whose calendar decides "today" — when a deadline has passed. */
  TIME_ZONE: z.string().min(1).default("Asia/Bangkok"),

  API_PORT: z.coerce.number().int().positive().default(4000),
}).refine((v) => v.T_LOW <= v.T_HIGH, {
  message: "T_LOW must not exceed T_HIGH",
  path: ["T_LOW"],
}).refine((v) => !(v.NODE_ENV === "production" && v.GCS_API_ENDPOINT), {
  message: "GCS_API_ENDPOINT is for the emulator only and must be unset in production",
  path: ["GCS_API_ENDPOINT"],
}).refine((v) => Boolean(v.GCS_API_ENDPOINT) || Boolean(v.GCS_CREDENTIALS), {
  message: "GCS_CREDENTIALS is required unless GCS_API_ENDPOINT points at the emulator",
  path: ["GCS_CREDENTIALS"],
}).refine((v) => Boolean(v.GCS_API_ENDPOINT) || Boolean(v.GOOGLE_CLOUD_PROJECT), {
  message: "GOOGLE_CLOUD_PROJECT is required unless GCS_API_ENDPOINT points at the emulator",
  path: ["GOOGLE_CLOUD_PROJECT"],
}).refine((v) => v.SEARCH_PAGE_SIZE <= v.SEARCH_MAX_PAGE_SIZE, {
  message: "SEARCH_PAGE_SIZE must not exceed SEARCH_MAX_PAGE_SIZE",
  path: ["SEARCH_PAGE_SIZE"],
});

export interface Config {
  mongoUrl: string;
  nodeEnv: "development" | "test" | "production";
  mail: {
    smtpUrl?: string;
    from: string;
    timeoutMs: number;
  };
  gcs: {
    bucket: string;
    apiEndpoint?: string;
    credentialsPath?: string;
    projectId?: string;
    timeoutApiMs: number;
    timeoutWorkerMs: number;
  };
  maxUploadBytes: number;
  allowedMimeTypes: string[];
  multipartMaxFiles: number;
  multipartMaxFieldBytes: number;
  intakeRateLimit: number;
  intakeApiKeys: string[];
  adminApiKeys: string[];
  session: {
    secret: string;
    lifetimeMs: number;
  };
  /** The browser origin allowed to make state-changing account requests. */
  appOrigin: string;
  argon2: {
    memoryKiB: number;
    iterations: number;
    parallelism: number;
  };
  authRateLimitPerIp: number;
  authRateLimitPerEmail: number;
  verifyTokenTtlMs: number;
  resetTokenTtlMs: number;
  consentNotice: { version: string; hash: string };
  fetchTimeoutMs: number;
  fetchMaxRedirects: number;
  fetchMaxBytes: number;
  jobMaxAttempts: number;
  jobBackoffMs: number;
  jobLockMs: number;
  jobPollMs: number;
  reconcileIntervalMs: number;
  reconcileMinAgeMs: number;
  vertex: {
    model: string;
    location: string;
    project?: string;
    credentialsPath?: string;
    timeoutMs: number;
  };
  tLow: number;
  tHigh: number;
  thresholdsVersion: string;
  budgetMinThb: number;
  budgetMaxThb: number;
  stats: {
    peerWindowMonths: number;
    peerMinN: number;
    method: "IQR" | "ZSCORE";
    iqrMultiplier: number;
    zScoreLimit: number;
    sweepIntervalMs: number;
    leaseMs: number;
    staleAfterMs: number;
    timezone: string;
  };
  adminQueuePageSize: number;
  search: SearchConfig;
  apiPort: number;
}

export interface SearchConfig {
  pageSize: number;
  maxPageSize: number;
  queryMaxChars: number;
  maxFilterValues: number;
  facetLimit: number;
  timeZone: string;
}

/**
 * Values awaiting measurement or calibration (SRS §8). They are declared here so
 * no later slice writes them as literals, and are read only once settled.
 * O1 (T_LOW / T_HIGH) is closed — measured by TOR-18, now a real config field.
 * O2 MIN_BID_WINDOW_DAYS · O3 MIN_SCOPE_CHARS / MIN_SCOPE_SECTIONS
 * O4 ANOMALY_METHOD (IQR or ZSCORE)
 */
export const OPEN_VALUES = [
  "MIN_BID_WINDOW_DAYS",
  "MIN_SCOPE_CHARS",
  "MIN_SCOPE_SECTIONS",
  "ANOMALY_METHOD",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  const parsed = schema.parse(env);
  return {
    mongoUrl: parsed.MONGO_URL,
    nodeEnv: parsed.NODE_ENV,
    mail: {
      smtpUrl: parsed.SMTP_URL,
      from: parsed.MAIL_FROM,
      timeoutMs: parsed.MAIL_TIMEOUT_MS,
    },
    gcs: {
      bucket: parsed.GCS_BUCKET,
      apiEndpoint: parsed.GCS_API_ENDPOINT,
      credentialsPath: parsed.GCS_CREDENTIALS,
      projectId: parsed.GOOGLE_CLOUD_PROJECT,
      timeoutApiMs: parsed.STORAGE_TIMEOUT_API_MS,
      timeoutWorkerMs: parsed.STORAGE_TIMEOUT_WORKER_MS,
    },
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    allowedMimeTypes: parsed.ALLOWED_MIME_TYPES.split(",").map((value) => value.trim()),
    multipartMaxFiles: parsed.MULTIPART_MAX_FILES,
    multipartMaxFieldBytes: parsed.MULTIPART_MAX_FIELD_BYTES,
    intakeRateLimit: parsed.INTAKE_RATE_LIMIT,
    intakeApiKeys: parsed.INTAKE_API_KEYS.split(",").map((value) => value.trim()).filter(Boolean),
    adminApiKeys: parsed.ADMIN_API_KEYS.split(",").map((value) => value.trim()).filter(Boolean),
    session: {
      secret: parsed.SESSION_SECRET,
      lifetimeMs: parsed.SESSION_LIFETIME_MS,
    },
    appOrigin: parsed.APP_ORIGIN,
    argon2: {
      memoryKiB: parsed.ARGON2_MEMORY_KIB,
      iterations: parsed.ARGON2_ITERATIONS,
      parallelism: parsed.ARGON2_PARALLELISM,
    },
    authRateLimitPerIp: parsed.AUTH_RATE_LIMIT_PER_IP,
    authRateLimitPerEmail: parsed.AUTH_RATE_LIMIT_PER_EMAIL,
    verifyTokenTtlMs: parsed.VERIFY_TOKEN_TTL_MS,
    resetTokenTtlMs: parsed.RESET_TOKEN_TTL_MS,
    consentNotice: { version: parsed.CONSENT_NOTICE_VERSION, hash: parsed.CONSENT_NOTICE_HASH },
    fetchTimeoutMs: parsed.FETCH_TIMEOUT_MS,
    fetchMaxRedirects: parsed.FETCH_MAX_REDIRECTS,
    fetchMaxBytes: parsed.FETCH_MAX_BYTES,
    jobMaxAttempts: parsed.JOB_MAX_ATTEMPTS,
    jobBackoffMs: parsed.JOB_BACKOFF_MS,
    jobLockMs: parsed.JOB_LOCK_MS,
    jobPollMs: parsed.JOB_POLL_MS,
    reconcileIntervalMs: parsed.RECONCILE_INTERVAL_MS,
    reconcileMinAgeMs: parsed.RECONCILE_MIN_AGE_MS,
    vertex: {
      model: parsed.GEMINI_MODEL,
      location: parsed.VERTEX_LOCATION,
      project: parsed.GOOGLE_CLOUD_PROJECT,
      credentialsPath: parsed.GOOGLE_APPLICATION_CREDENTIALS,
      timeoutMs: parsed.EXTRACT_TIMEOUT_MS,
    },
    tLow: parsed.T_LOW,
    tHigh: parsed.T_HIGH,
    thresholdsVersion: parsed.THRESHOLDS_VERSION,
    budgetMinThb: parsed.BUDGET_MIN_THB,
    budgetMaxThb: parsed.BUDGET_MAX_THB,
    stats: {
      peerWindowMonths: parsed.PEER_GROUP_WINDOW_MONTHS,
      peerMinN: parsed.PEER_MIN_N,
      method: parsed.ANOMALY_METHOD,
      iqrMultiplier: parsed.ANOMALY_IQR_MULTIPLIER,
      zScoreLimit: parsed.ANOMALY_ZSCORE_LIMIT,
      sweepIntervalMs: parsed.STATS_SWEEP_INTERVAL_MS,
      leaseMs: parsed.STATS_LEASE_MS,
      staleAfterMs: parsed.STATS_STALE_AFTER_MS,
      timezone: parsed.COHORT_TIMEZONE,
    },
    adminQueuePageSize: parsed.ADMIN_QUEUE_PAGE_SIZE,
    search: {
      pageSize: parsed.SEARCH_PAGE_SIZE,
      maxPageSize: parsed.SEARCH_MAX_PAGE_SIZE,
      queryMaxChars: parsed.SEARCH_QUERY_MAX_CHARS,
      maxFilterValues: parsed.SEARCH_MAX_FILTER_VALUES,
      facetLimit: parsed.SEARCH_FACET_LIMIT,
      timeZone: parsed.TIME_ZONE,
    },
    apiPort: parsed.API_PORT,
  };
}
