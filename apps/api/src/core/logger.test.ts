import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureLogger, logger, sanitize, setLogSink } from "./logger.js";

let lines: Record<string, unknown>[];

beforeEach(() => {
  lines = [];
  setLogSink((line) => lines.push(JSON.parse(line) as Record<string, unknown>));
  configureLogger("info");
});
afterEach(() => setLogSink());

describe("logger", () => {
  it("writes one JSON line with the severity and message fields Cloud Logging parses", () => {
    logger.warn("job_failed", { jobId: "a1" });
    expect(lines).toEqual([expect.objectContaining({ severity: "WARNING", message: "job_failed", jobId: "a1", time: expect.any(String) })]);
  });

  it("drops lines below the configured level", () => {
    logger.debug("noise");
    logger.info("kept");
    configureLogger("error");
    logger.warn("dropped");
    expect(lines.map((line) => line.message)).toEqual(["kept"]);
  });

  it("marks security events and lets a caller field neither rename them nor change their category", () => {
    logger.security("auth.denied", { message: "spoofed", category: "other", status: 403 });
    expect(lines[0]).toMatchObject({ severity: "WARNING", message: "auth.denied", category: "security", status: 403 });
  });

  it("masks credential keys at any depth and never logs bodies or bytes", () => {
    const clean = sanitize({
      password: "p1-value", nested: { Authorization: "Bearer-x", apiKey: "key-value", "x-api-key": "key-value", cookie: "cookie-value", sessionId: "sess-value", resetToken: "tok-value" },
      body: { email: "a@b.test" }, bytes: Buffer.from("secret doc"), ok: "visible",
    });
    const text = JSON.stringify(clean);
    expect(text).not.toMatch(/p1-value|Bearer-x|key-value|cookie-value|sess-value|tok-value|a@b\.test|secret doc/);
    expect(text).toContain("visible");
  });

  it("keeps an Error to its name and message, and truncates long strings", () => {
    expect(sanitize(new Error("boom"))).toEqual({ name: "Error", message: "boom" });
    expect((sanitize("x".repeat(2000)) as string).length).toBeLessThan(600);
  });
});
