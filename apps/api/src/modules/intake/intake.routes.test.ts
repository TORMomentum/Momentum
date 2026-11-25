import { AS_ADMIN, AS_VENDOR, TEST_ADMIN_ID, testSession } from "../../test/admin-session.js";
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { buildIntakeRouter } from "./intake.routes.js";
import { errorMiddleware } from "../../core/errors.js";
import type { IntakeService } from "./intake.service.js";

const pdf = Buffer.from("%PDF-1.7 test body");

function appWith(
  submit = vi.fn().mockResolvedValue({ torId: "t1", duplicate: false, state: "queued" }),
) {
  const app = express();
  app.use(express.json());
  app.use(testSession());
  app.use(
    "/api/v1/intake",
    buildIntakeRouter({
      service: { submit } as unknown as IntakeService,
      intakeKeys: ["intake-key"],
      maxUploadBytes: 1_000_000,
      multipartMaxFiles: 1,
      multipartMaxFieldBytes: 8_192,
      fetchLimits: { timeoutMs: 1_000, maxRedirects: 2, maxBytes: 1_000_000 },
      rateLimitPerMinute: 1_000,
    }),
  );
  app.use(errorMiddleware);
  return { app, submit };
}

describe("intake routes: access control", () => {
  it("accepts an upload from an admin account, recorded as that account, and answers 202", async () => {
    const { app, submit } = appWith();

    const response = await request(app)
      .post("/api/v1/intake/upload")
      .set(AS_ADMIN)
      .attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ torId: "t1", state: "queued" });
    expect(submit).toHaveBeenCalledOnce();
    // TOR-300: the record names the admin who sent it, not a shared "admin".
    expect(submit.mock.calls[0]![1]).toMatchObject({ route: "upload", submittedBy: TEST_ADMIN_ID });
  });

  it("refuses an upload to a vendor account", async () => {
    const { app, submit } = appWith();
    const response = await request(app).post("/api/v1/intake/upload").set(AS_VENDOR).attach("file", pdf, "tor.pdf");
    expect(response.status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses an upload with no credentials", async () => {
    const { app, submit } = appWith();

    const response = await request(app).post("/api/v1/intake/upload").attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(401);
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses an admin route to a caller holding only the intake key", async () => {
    const { app, submit } = appWith();

    const response = await request(app)
      .post("/api/v1/intake/upload")
      .set("x-api-key", "intake-key")
      .attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(401);
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses the programmatic route with no credentials", async () => {
    const { app } = appWith();

    const response = await request(app).post("/api/v1/intake").attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(401);
  });

  it("accepts the programmatic route with an intake key", async () => {
    const { app, submit } = appWith();

    const response = await request(app)
      .post("/api/v1/intake")
      .set("x-api-key", "intake-key")
      .attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(202);
    expect(submit).toHaveBeenCalledOnce();
  });
});

describe("intake routes: the URL route refuses what it must not fetch", () => {
  it("rejects an address inside the cloud metadata range", async () => {
    const { app, submit } = appWith();

    const response = await request(app)
      .post("/api/v1/intake/url")
      .set(AS_ADMIN)
      .send({ url: "http://169.254.169.254/latest/meta-data/" });

    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects a loopback address", async () => {
    const { app, submit } = appWith();

    const response = await request(app)
      .post("/api/v1/intake/url")
      .set(AS_ADMIN)
      .send({ url: "http://127.0.0.1:9010/tor-raw" });

    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects a scheme outside the allowlist", async () => {
    const { app } = appWith();

    const response = await request(app)
      .post("/api/v1/intake/url")
      .set(AS_ADMIN)
      .send({ url: "file:///etc/passwd" });

    expect(response.status).toBe(400);
  });

  it("rejects a body that is not a URL at all", async () => {
    const { app } = appWith();

    const response = await request(app)
      .post("/api/v1/intake/url")
      .set(AS_ADMIN)
      .send({ url: "not-a-url" });

    expect(response.status).toBe(400);
  });
});

describe("intake routes: responses", () => {
  it("answers 200 rather than 202 for a repeat submission", async () => {
    const submit = vi.fn().mockResolvedValue({ torId: "t1", duplicate: true, state: "queued" });
    const { app } = appWith(submit);

    const response = await request(app)
      .post("/api/v1/intake/upload")
      .set(AS_ADMIN)
      .attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(200);
    expect(response.body.duplicate).toBe(true);
  });

  it("rejects a request that carries no file", async () => {
    const { app } = appWith();

    const response = await request(app)
      .post("/api/v1/intake/upload")
      .set(AS_ADMIN)
      .field("note", "no file here");

    expect(response.status).toBe(400);
  });

  it("returns a typed error shape, never a stack trace", async () => {
    const { app } = appWith();

    const response = await request(app).post("/api/v1/intake/upload").attach("file", pdf, "t.pdf");

    expect(response.body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain("at ");
  });
});
