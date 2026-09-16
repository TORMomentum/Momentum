import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  MONGO_URL: "mongodb://mongo:27017/tor_radar",
  INTAKE_API_KEYS: "test-key",
  ADMIN_API_KEYS: "admin-key",
  GCS_BUCKET: "tor-raw",
  GCS_API_ENDPOINT: "http://localhost:4443",
};

describe("loadConfig", () => {
  it("applies documented defaults when optional values are absent", () => {
    const config = loadConfig(base);
    expect(config.maxUploadBytes).toBe(26_214_400);
    expect(config.jobMaxAttempts).toBe(5);
  });

  it("parses the API key list into individual keys", () => {
    const config = loadConfig({ ...base, INTAKE_API_KEYS: "a,b , c" });
    expect(config.intakeApiKeys).toEqual(["a", "b", "c"]);
  });

  it("fails fast when a required value is missing", () => {
    const { MONGO_URL, ...withoutMongo } = base;
    expect(() => loadConfig(withoutMongo)).toThrow(/MONGO_URL/);
  });

  it("rejects a non-numeric override instead of silently coercing", () => {
    expect(() => loadConfig({ ...base, MAX_UPLOAD_BYTES: "big" })).toThrow();
  });

  it("carries the measured confidence thresholds and their version (O1 closed)", () => {
    const config = loadConfig(base);
    expect(config.tLow).toBe(0.8);
    expect(config.tHigh).toBe(0.95);
    expect(config.thresholdsVersion).toBe("2026-09-03");
  });

  it("does not require the Vertex credential to load — the adapter checks it at call time", () => {
    const config = loadConfig(base);
    expect(config.vertex.project).toBeUndefined();
    expect(config.vertex.model).toBe("gemini-3.5-flash");
  });

  it("carries the budget sanity bounds", () => {
    const config = loadConfig(base);
    expect(config.budgetMinThb).toBe(10_000);
    expect(config.budgetMaxThb).toBe(100_000_000_000);
  });

  it("carries the statistics settings and rejects an unknown anomaly method", () => {
    const config = loadConfig(base);
    expect(config.stats.peerWindowMonths).toBe(12);
    expect(config.stats.peerMinN).toBe(8);
    expect(config.stats.method).toBe("IQR");
    expect(config.stats.iqrMultiplier).toBe(1.5);
    expect(config.stats.zScoreLimit).toBe(3);
    expect(config.stats.sweepIntervalMs).toBe(300_000);
    expect(config.stats.leaseMs).toBe(60_000);
    expect(config.stats.staleAfterMs).toBe(3_600_000);
    expect(config.stats.timezone).toBe("Asia/Bangkok");
    expect(() => loadConfig({ ...base, ANOMALY_METHOD: "NONSENSE" })).toThrow();
    // The fence multiplier is fractional. Zod does not validate a default, so an
    // int() schema passes this suite and then rejects the very value
    // .env.example ships — the app would fail to boot from its own template.
    expect(loadConfig({ ...base, ANOMALY_IQR_MULTIPLIER: "1.5" }).stats.iqrMultiplier).toBe(1.5);
    expect(loadConfig({ ...base, ANOMALY_ZSCORE_LIMIT: "2.5" }).stats.zScoreLimit).toBe(2.5);
  });

  it("rejects a T_LOW above T_HIGH", () => {
    expect(() => loadConfig({ ...base, T_LOW: "0.99", T_HIGH: "0.9" })).toThrow(/T_LOW/);
  });

  it("reads the storage bucket, endpoint and both timeouts", () => {
    const config = loadConfig({ ...base, GCS_BUCKET: "tor-originals", GCS_API_ENDPOINT: "http://gcs:4443" });
    expect(config.gcs.bucket).toBe("tor-originals");
    expect(config.gcs.apiEndpoint).toBe("http://gcs:4443");
    expect(config.gcs.timeoutApiMs).toBe(10_000);
    expect(config.gcs.timeoutWorkerMs).toBe(60_000);
  });

  it("requires dedicated storage credentials and a project when not using the emulator", () => {
    const { GCS_API_ENDPOINT: _emulator, ...real } = base;
    expect(() => loadConfig({ ...real, GCS_BUCKET: "tor-originals" })).toThrow(/GCS_CREDENTIALS/);
    expect(() =>
      loadConfig({ ...real, GCS_BUCKET: "tor-originals", GCS_CREDENTIALS: "/secrets/storage.json" }),
    ).toThrow(/GOOGLE_CLOUD_PROJECT/);
  });

  it("refuses the emulator endpoint in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/GCS_API_ENDPOINT/);
  });

  it("never falls back to the Vertex AI credential for storage", () => {
    const config = loadConfig({
      ...base,
      GCS_BUCKET: "tor-originals",
      GCS_CREDENTIALS: "/secrets/storage.json",
      GOOGLE_APPLICATION_CREDENTIALS: "/secrets/vertex.json",
    });
    expect(config.gcs.credentialsPath).toBe("/secrets/storage.json");
  });
});
