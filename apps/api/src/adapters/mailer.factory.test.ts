import { describe, expect, it } from "vitest";
import { loadConfig } from "../core/config.js";
import { LogMailer } from "./log.mailer.js";
import { createMailer } from "./mailer.factory.js";
import { SmtpMailer } from "./smtp.mailer.js";

const base = {
  MONGO_URL: "mongodb://mongo:27017/tor_radar",
  INTAKE_API_KEYS: "test-key",
  ADMIN_API_KEYS: "admin-key",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
  APP_ORIGIN: "https://app.example.test",
  GCS_BUCKET: "tor-raw",
  GCS_API_ENDPOINT: "http://gcs:4443",
};

describe("createMailer", () => {
  it("uses the recording adapter when SMTP is not configured", () => {
    expect(createMailer(loadConfig(base))).toBeInstanceOf(LogMailer);
  });

  it("uses SMTP when its URL is configured", () => {
    expect(createMailer(loadConfig({ ...base, SMTP_URL: "smtp://mail.example.test" }))).toBeInstanceOf(SmtpMailer);
  });

  it("refuses the recording adapter in production", () => {
    const { GCS_API_ENDPOINT: _emulator, ...production } = base;
    const config = loadConfig({
      ...production,
      NODE_ENV: "production",
      GCS_CREDENTIALS: "/secrets/storage.json",
      GOOGLE_CLOUD_PROJECT: "tor-radar",
    });

    expect(() => createMailer(config)).toThrow(/SMTP_URL/);
  });
});
