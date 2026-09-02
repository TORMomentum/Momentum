import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  MONGO_URL: "mongodb://mongo:27017/tor_radar",
  MINIO_ENDPOINT: "minio",
  MINIO_PORT: "9000",
  MINIO_ACCESS_KEY: "key",
  MINIO_SECRET_KEY: "secret",
  MINIO_BUCKET: "tor-raw",
  MINIO_PUBLIC_URL: "http://localhost:9000",
  INTAKE_API_KEYS: "test-key",
  ADMIN_API_KEYS: "admin-key",
};

describe("loadConfig", () => {
  it("applies documented defaults when optional values are absent", () => {
    const config = loadConfig(base);
    expect(config.maxUploadBytes).toBe(26_214_400);
    expect(config.jobMaxAttempts).toBe(5);
    expect(config.signedUrlTtlSeconds).toBe(300);
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
});
