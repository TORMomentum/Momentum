import "../../test/env.js";

import { AS_ADMIN, testSession } from "../../test/admin-session.js";
import express from "express";
import { ObjectId, type Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../../core/config.js";
import { accounts, connect, disconnect, ensureIndexes, sourceHealth, tors, type TorDocument } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import type { MailMessage, Mailer } from "../../ports/mailer.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { SourceHealthRepository } from "./source-health.repository.js";
import { ERROR_MAX_CHARS, healthOf, SourceHealthService } from "./source-health.service.js";
import { BMA_EGP_IMPORT_ID, NATIONAL_EGP_AWARDS_ID, NATIONAL_EGP_IMPORT_ID, STAGES_SOURCE_ID } from "./sources.registry.js";
import { buildSourcesRouter } from "./sources.routes.js";

const base = loadConfig(process.env);
const config: Config = { ...base, sources: { alertFailures: 3, staleMs: 48 * 3_600_000, heartbeatMs: 3_600_000, checkIntervalMs: 3_600_000 } };
const NOW = new Date("2026-11-24T03:00:00Z");
const HOUR = 3_600_000;
let db: Db;
let sent: MailMessage[];

const mailer: Mailer = {
  async send(message) {
    sent.push(message);
    return { messageId: `m${sent.length}` };
  },
};

function service(withMailer = true) {
  return new SourceHealthService({ repo: new SourceHealthRepository(db), config, ...(withMailer ? { mailer } : {}) });
}

const ok = { ok: true, items: 10, failed: 0, error: null };
const refused = { ok: false, items: 3, failed: 3, error: "Source responded with status 429" };

async function admin(email: string, extra: Record<string, unknown> = {}) {
  await accounts(db).insertOne({
    email,
    role: "admin",
    emailVerifiedAt: NOW,
    consent: { noticeVersion: "t", noticeHash: "t", agreedAt: NOW, action: "checkbox" },
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  } as never);
}

async function tor(system: string, extra: Partial<TorDocument> = {}) {
  await tors(db).insertOne({
    contentHash: new ObjectId().toHexString(),
    storage: { bucket: "raw", key: new ObjectId().toHexString(), contentType: "application/pdf", bytes: 1 },
    sourceRefs: [],
    pipeline: { state: "published", attempts: 1 },
    fields: {},
    announcedAt: null,
    sourceProject: { system, projectId: new ObjectId().toHexString() },
    sourceUrl: null,
    unverified: false,
    statusHistory: [],
    access: { restricted: false },
    duplicateOf: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  } as TorDocument);
}

const read = (id: string) => sourceHealth(db).findOne({ _id: id });

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "source-health"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  sent = [];
  await Promise.all([sourceHealth(db).deleteMany({}), accounts(db).deleteMany({}), tors(db).deleteMany({})]);
});

afterAll(async () => {
  await disconnect();
});

describe("healthOf (TOR-87)", () => {
  const settings = config.sources;
  const seen = (hoursAgo: number, failures = 0) => ({ lastSeenAt: new Date(NOW.getTime() - hoursAgo * HOUR), consecutiveFailures: failures });

  it("names an automatic source failing, stale, ok or never run", () => {
    const automatic = { kind: "automatic" as const };
    expect(healthOf(automatic, null, NOW, settings)).toBe("never");
    expect(healthOf(automatic, seen(1), NOW, settings)).toBe("ok");
    expect(healthOf(automatic, seen(1, 2), NOW, settings)).toBe("ok");
    expect(healthOf(automatic, seen(1, 3), NOW, settings)).toBe("failing");
    expect(healthOf(automatic, seen(49), NOW, settings)).toBe("stale");
    expect(healthOf(automatic, { lastSeenAt: null, consecutiveFailures: 0 }, NOW, settings)).toBe("stale");
  });

  it("never calls a manual source stale, and calls it failing when its last run failed", () => {
    const manual = { kind: "manual" as const };
    expect(healthOf(manual, seen(24 * 30), NOW, settings)).toBe("ok");
    expect(healthOf(manual, seen(24 * 30, 1), NOW, settings)).toBe("failing");
  });
});

describe("recording a source's runs (TOR-292)", () => {
  it("counts failures in a row, keeps the last failure, resets on success, and cuts a long message", async () => {
    await service().recordRun(STAGES_SOURCE_ID, refused, NOW);
    await service().recordRun(STAGES_SOURCE_ID, { ...refused, error: "x".repeat(1000) }, new Date(NOW.getTime() + HOUR));
    let record = await read(STAGES_SOURCE_ID);
    expect(record).toMatchObject({ consecutiveFailures: 2, lastSuccessAt: null, alert: null });
    expect(record?.lastError).toHaveLength(ERROR_MAX_CHARS);
    expect(record?.lastFailureAt).toEqual(new Date(NOW.getTime() + HOUR));

    const later = new Date(NOW.getTime() + 2 * HOUR);
    await service().recordRun(STAGES_SOURCE_ID, ok, later);
    record = await read(STAGES_SOURCE_ID);
    expect(record).toMatchObject({ consecutiveFailures: 0, lastSuccessAt: later, lastSeenAt: later, lastRun: { at: later, items: 10, failed: 0 } });
    expect(record?.lastFailureAt).toEqual(new Date(NOW.getTime() + HOUR));
  });

  it("takes a heartbeat as a sign of life, not a success", async () => {
    await service().heartbeat(STAGES_SOURCE_ID, NOW);
    expect(await read(STAGES_SOURCE_ID)).toMatchObject({ lastSeenAt: NOW, lastSuccessAt: null, consecutiveFailures: 0, lastRun: null });
  });
});

describe("GET /admin/sources (TOR-293)", () => {
  function app() {
    const result = express();
    result.use(testSession());
    result.use("/api/v1/admin", buildSourcesRouter({ service: service(false) }));
    result.use(errorMiddleware);
    return result;
  }

  it("is refused without a signed-in admin account", async () => {
    expect((await request(app()).get("/api/v1/admin/sources")).status).toBe(401);
  });

  it("lists every source in order with its health and what it has given us", async () => {
    await tor("national-egp", { stagesCheckedAt: NOW });
    await tor("national-egp");
    await tor("national-egp", { documentType: "invitation" });
    // A winner announcement counts for its own source only (TOR-221).
    await tor("national-egp", { documentType: "award" });
    await tor("bma-egp");
    await service().recordRun(STAGES_SOURCE_ID, ok, new Date());
    await service().recordRun(BMA_EGP_IMPORT_ID, { ok: false, items: 0, failed: 0, error: "e-GP list unavailable" }, NOW);

    const response = await request(app()).get("/api/v1/admin/sources").set(AS_ADMIN);

    expect(response.status).toBe(200);
    expect(response.body.settings).toEqual({ alertFailures: 3, staleHours: 48 });
    const rows = response.body.sources.map((row: Record<string, unknown>) => [row.id, row.kind, row.status, row.records]);
    expect(rows).toEqual([
      [STAGES_SOURCE_ID, "automatic", "ok", 1],
      [NATIONAL_EGP_IMPORT_ID, "manual", "never", 2],
      [NATIONAL_EGP_AWARDS_ID, "manual", "never", 1],
      [BMA_EGP_IMPORT_ID, "manual", "failing", 1],
    ]);
    expect(response.body.sources[3].lastError).toBe("e-GP list unavailable");
  });
});

describe("alerting admins (TOR-294)", () => {
  it("emails every reachable admin once when an automatic source starts failing, and once when it recovers", async () => {
    await admin("a@example.test");
    await admin("b@example.test");
    await admin("unverified@example.test", { emailVerifiedAt: undefined });
    await admin("disabled@example.test", { disabledAt: NOW });
    await accounts(db).insertOne({ email: "vendor@example.test", role: "vendor", emailVerifiedAt: NOW, consent: { noticeVersion: "t", noticeHash: "t", agreedAt: NOW, action: "checkbox" }, createdAt: NOW, updatedAt: NOW });
    await accounts(db).updateOne({ email: "unverified@example.test" }, { $unset: { emailVerifiedAt: "" } });

    for (let i = 0; i < 3; i += 1) await service().recordRun(STAGES_SOURCE_ID, refused, NOW);
    expect(await service().checkSources(NOW)).toEqual({ alerted: 1, recovered: 0 });
    expect(await service().checkSources(NOW)).toEqual({ alerted: 0, recovered: 0 });
    expect(sent.map((mail) => mail.to).sort()).toEqual(["a@example.test", "b@example.test"]);
    expect(sent[0]!.subject).toBe("[TOR Radar] แหล่งข้อมูลมีปัญหา: e-GP — ขั้นตอนโครงการ");
    expect(sent[0]!.text).toContain("ดึงข้อมูลล้มเหลวติดกัน 3 ครั้ง");
    expect(sent[0]!.text).toContain("Source responded with status 429");
    expect((await read(STAGES_SOURCE_ID))?.alert).toEqual({ kind: "failing", sentAt: NOW });

    sent = [];
    await service().recordRun(STAGES_SOURCE_ID, ok, NOW);
    expect(await service().checkSources(NOW)).toEqual({ alerted: 0, recovered: 1 });
    expect(await service().checkSources(NOW)).toEqual({ alerted: 0, recovered: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.subject).toBe("[TOR Radar] แหล่งข้อมูลกลับมาปกติ: e-GP — ขั้นตอนโครงการ");
    expect((await read(STAGES_SOURCE_ID))?.alert).toBeNull();
  });

  it("alerts on an automatic source that has gone quiet, but never on a manual one or one that never ran", async () => {
    await admin("a@example.test");
    await service().heartbeat(STAGES_SOURCE_ID, new Date(NOW.getTime() - 49 * HOUR));
    await service().recordRun(NATIONAL_EGP_IMPORT_ID, refused, NOW);

    expect(await service().checkSources(NOW)).toEqual({ alerted: 1, recovered: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("ไม่มีสัญญาณจากตัวดึงข้อมูลเกิน 48 ชั่วโมง");
    expect((await read(NATIONAL_EGP_IMPORT_ID))?.alert).toBeNull();
  });

  it("claims the alert with no admin to tell, so it is not retried every check", async () => {
    for (let i = 0; i < 3; i += 1) await service().recordRun(STAGES_SOURCE_ID, refused, NOW);
    expect(await service().checkSources(NOW)).toEqual({ alerted: 1, recovered: 0 });
    expect(await service().checkSources(NOW)).toEqual({ alerted: 0, recovered: 0 });
    expect(sent).toHaveLength(0);
  });

  it("escapes a source's error message in the email", async () => {
    await admin("a@example.test");
    for (let i = 0; i < 3; i += 1) await service().recordRun(STAGES_SOURCE_ID, { ...refused, error: "<script>x</script>" }, NOW);
    await service().checkSources(NOW);
    expect(sent[0]!.html).not.toContain("<script>");
    expect(sent[0]!.html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
