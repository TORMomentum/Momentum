import { z } from "zod";

/**
 * Every threshold and tunable in the system (NFR-S7). Nothing below may appear
 * as a literal anywhere else in the codebase.
 */
const schema = z.object({
  // Storage — two endpoints: one reachable inside the compose network, one from a browser.
  MONGO_URL: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  MINIO_PUBLIC_URL: z.url(),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  // Intake limits
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(26_214_400),
  ALLOWED_MIME_TYPES: z.string().default("application/pdf,image/jpeg,image/png"),
  MULTIPART_MAX_FILES: z.coerce.number().int().positive().default(1),
  MULTIPART_MAX_FIELD_BYTES: z.coerce.number().int().positive().default(8_192),
  INTAKE_RATE_LIMIT: z.coerce.number().int().positive().default(60),
  INTAKE_API_KEYS: z.string().min(1),
  ADMIN_API_KEYS: z.string().min(1),

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

  API_PORT: z.coerce.number().int().positive().default(4000),
});

export interface Config {
  mongoUrl: string;
  minio: {
    endPoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    bucket: string;
    publicUrl: string;
  };
  signedUrlTtlSeconds: number;
  maxUploadBytes: number;
  allowedMimeTypes: string[];
  multipartMaxFiles: number;
  multipartMaxFieldBytes: number;
  intakeRateLimit: number;
  intakeApiKeys: string[];
  adminApiKeys: string[];
  fetchTimeoutMs: number;
  fetchMaxRedirects: number;
  fetchMaxBytes: number;
  jobMaxAttempts: number;
  jobBackoffMs: number;
  jobLockMs: number;
  jobPollMs: number;
  reconcileIntervalMs: number;
  reconcileMinAgeMs: number;
  apiPort: number;
}

/**
 * Values awaiting measurement or calibration (SRS §8). They are declared here so
 * no later slice writes them as literals, and are read only once settled.
 * O1 T_LOW / T_HIGH · O2 MIN_BID_WINDOW_DAYS · O3 MIN_SCOPE_CHARS / MIN_SCOPE_SECTIONS
 * O4 ANOMALY_METHOD (IQR or ZSCORE)
 */
export const OPEN_VALUES = [
  "T_LOW",
  "T_HIGH",
  "MIN_BID_WINDOW_DAYS",
  "MIN_SCOPE_CHARS",
  "MIN_SCOPE_SECTIONS",
  "ANOMALY_METHOD",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  const parsed = schema.parse(env);
  return {
    mongoUrl: parsed.MONGO_URL,
    minio: {
      endPoint: parsed.MINIO_ENDPOINT,
      port: parsed.MINIO_PORT,
      accessKey: parsed.MINIO_ACCESS_KEY,
      secretKey: parsed.MINIO_SECRET_KEY,
      bucket: parsed.MINIO_BUCKET,
      publicUrl: parsed.MINIO_PUBLIC_URL,
    },
    signedUrlTtlSeconds: parsed.SIGNED_URL_TTL_SECONDS,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    allowedMimeTypes: parsed.ALLOWED_MIME_TYPES.split(",").map((value) => value.trim()),
    multipartMaxFiles: parsed.MULTIPART_MAX_FILES,
    multipartMaxFieldBytes: parsed.MULTIPART_MAX_FIELD_BYTES,
    intakeRateLimit: parsed.INTAKE_RATE_LIMIT,
    intakeApiKeys: parsed.INTAKE_API_KEYS.split(",").map((value) => value.trim()).filter(Boolean),
    adminApiKeys: parsed.ADMIN_API_KEYS.split(",").map((value) => value.trim()).filter(Boolean),
    fetchTimeoutMs: parsed.FETCH_TIMEOUT_MS,
    fetchMaxRedirects: parsed.FETCH_MAX_REDIRECTS,
    fetchMaxBytes: parsed.FETCH_MAX_BYTES,
    jobMaxAttempts: parsed.JOB_MAX_ATTEMPTS,
    jobBackoffMs: parsed.JOB_BACKOFF_MS,
    jobLockMs: parsed.JOB_LOCK_MS,
    jobPollMs: parsed.JOB_POLL_MS,
    reconcileIntervalMs: parsed.RECONCILE_INTERVAL_MS,
    reconcileMinAgeMs: parsed.RECONCILE_MIN_AGE_MS,
    apiPort: parsed.API_PORT,
  };
}
