import "../../test/env.js";
import express from "express";
import { ObjectId, type Db } from "mongodb";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type Config } from "../../core/config.js";
import { accounts, connect, disconnect, ensureIndexes, sessions, tors, vaultDocuments, vendorProfiles } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { sessionContext } from "../../core/session-context.js";
import { GenerationError, type TextGenerator } from "../../ports/text-generator.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountsRepository } from "../accounts/accounts.repository.js";
import { hashPassword } from "../accounts/password.js";
import { SessionsRepository } from "../accounts/sessions.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { TorsRepository } from "../tors/tors.repository.js";
import { TorsService } from "../tors/tors.service.js";
import { VaultRepository } from "../vault/vault.repository.js";
import { buildDraftsRouter } from "./drafts.routes.js";
import { DraftsService } from "./drafts.service.js";

const baseConfig = loadConfig(process.env);
let config: Config;
let db: Db;
let sessionsRepository: SessionsRepository;
let accountsRepository: AccountsRepository;
let app: express.Express;
let generate: ReturnType<typeof vi.fn<TextGenerator["generate"]>>;

const field = (value: unknown, raw = "") => ({ raw, value, confidence: 0.95, verified: true });

function buildApp(draft: Partial<Config["draft"]> = {}) {
  config = { ...baseConfig, draft: { ...baseConfig.draft, enabled: true, ...draft } };
  const generator: TextGenerator = { generate: (input) => generate(input) };
  const result = express();
  result.use(express.json());
  result.use(sessionContext(sessionsRepository));
  result.use("/api/v1", buildDraftsRouter({
    config,
    service: new DraftsService({
      tors: new TorsService({ repo: new TorsRepository(db, config.search), config }),
      profiles: new ProfileRepository(db), vault: new VaultRepository(db), generator,
    }),
  }));
  result.use(errorMiddleware);
  return result;
}

async function sessionFor(email: string) {
  const created = await accountsRepository.create({
    email, displayName: "สมชาย ใจดี", passwordHash: await hashPassword("correct-password", config),
    consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox" },
  });
  return { session: (await sessionsRepository.create(created.id)).id, accountId: created.id };
}

async function seedProfile(accountId: string, categories = ["building"]) {
  await vendorProfiles(db).insertOne({
    accountId, categories, areas: ["thailand"], budget: null, taxonomyVersion: "t", updatedAt: new Date(),
    certifications: { cgd: [], tags: ["iso-9001"], other: [] },
    personnel: [{ id: "p1", role: "วิศวกรโยธา", certifications: ["engineer"], other: [] }],
    pastProjects: [{ id: "j1", title: "ก่อสร้างอาคารเรียน", year: 2566, valueThb: 5_000_000 }],
  } as never);
}

async function seedTor(restricted = false): Promise<string> {
  const now = new Date();
  const result = await tors(db).insertOne({
    contentHash: `draft-${new ObjectId().toString()}`,
    storage: { bucket: "tor-raw", key: "k", contentType: "application/pdf", bytes: 1 },
    sourceRefs: [{ route: "upload", submittedBy: "admin", submittedAt: now }],
    pipeline: { state: "published", attempts: 1 },
    fields: {
      title: field("จ้างก่อสร้างอาคารสำนักงาน", "จ้างก่อสร้างอาคารสำนักงาน"), agency: field("กรมตัวอย่าง", "กรมตัวอย่าง"),
      budget: field(1_000_000, "1,000,000"), category: field("x", "x"), scopeSummary: field("x", "ก่อสร้างอาคาร 3 ชั้น"),
      qualifications: field(["มีผลงานก่อสร้าง"]), deadline: field("2026-12-30", "30 ธันวาคม 2569"), contact: field("x", "x"),
      torStatus: field("announced"),
      requiredDocuments: field([
        { name: "ใบรับรอง ISO 9001", holder: "company", certification: "iso-9001" },
        { name: "ใบอนุญาตวิศวกร", holder: "personnel", certification: "engineer" },
        { name: "ISO 9001 และ ISO 14001", holder: "company", certification: "iso-9001" },
        { name: "หนังสือรับรองผลงาน", holder: "company" },
      ]),
    },
    announcedAt: now, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted }, duplicateOf: null, createdAt: now, updatedAt: now,
  } as never);
  return result.insertedId.toString();
}

async function seedVault(accountId: string) {
  await vaultDocuments(db).insertOne({
    _id: new ObjectId(), accountId, slot: 0, key: `vault/${accountId}/secret-key`, status: "ready", uploadedAt: new Date(),
    kind: "certificate", certificationId: "iso-9001", filename: "iso9001.pdf", contentType: "application/pdf", bytes: 10, sha256: "abc123hash",
  } as never);
}

const draftFor = (who: { session: string }, torId: string) =>
  request(app).post(`/api/v1/me/tors/${torId}/draft`).set("x-session-id", who.session).set("origin", config.appOrigin);

beforeAll(async () => {
  db = await connect(isolatedDbUrl(baseConfig.mongoUrl, "drafts-routes"));
  await ensureIndexes(db);
  sessionsRepository = new SessionsRepository(db, baseConfig.session.lifetimeMs);
  accountsRepository = new AccountsRepository(db, sessionsRepository);
});
beforeEach(async () => {
  await Promise.all([accounts(db).deleteMany({}), sessions(db).deleteMany({}), tors(db).deleteMany({}), vendorProfiles(db).deleteMany({}), vaultDocuments(db).deleteMany({})]);
  generate = vi.fn<TextGenerator["generate"]>(async () => ({ text: "เรียน ผู้อำนวยการ [ชื่อบริษัท]", modelVersion: "gemini-test-001" }));
  app = buildApp();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await disconnect(); });

describe("AI draft of a cover letter (TOR-220)", () => {
  it("drafts from the profile, the TOR and the kept files, and says which model wrote it", async () => {
    const me = await sessionFor("one@example.test");
    await seedProfile(me.accountId);
    await seedVault(me.accountId);
    const torId = await seedTor();

    const response = await draftFor(me, torId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ text: "เรียน ผู้อำนวยการ [ชื่อบริษัท]", modelVersion: "gemini-test-001" });
    expect(Date.parse(response.body.generatedAt)).not.toBeNaN();
    expect(response.headers["cache-control"]).toContain("no-store");
    const { system, prompt } = generate.mock.calls[0]![0] as { system: string; prompt: string };
    expect(system).toContain("ห้ามแต่งหรือเดาข้อมูลเพิ่ม");
    for (const wanted of ["จ้างก่อสร้างอาคารสำนักงาน", "กรมตัวอย่าง", "30 ธันวาคม 2569", "ก่อสร้างอาคาร 3 ชั้น", "ISO 9001", "ทั่วประเทศ", "วิศวกรโยธา", "ก่อสร้างอาคารเรียน"]) {
      expect(prompt).toContain(wanted);
    }
  });

  it("tells the model which required documents are attached, which are not and which the vendor must check", async () => {
    const me = await sessionFor("one@example.test");
    await seedProfile(me.accountId);
    await seedVault(me.accountId);
    await draftFor(me, await seedTor());

    const { prompt } = generate.mock.calls[0]![0] as { prompt: string };
    expect(prompt).toContain("- ใบรับรอง ISO 9001 — มีไฟล์ (iso9001.pdf)");
    expect(prompt).toContain("- ใบอนุญาตวิศวกร — ยังไม่มีไฟล์");
    expect(prompt).toContain("- ISO 9001 และ ISO 14001 — ตรวจเอง"); // several certifications: not decided from the first
    expect(prompt).toContain("- หนังสือรับรองผลงาน — ตรวจเอง");
  });

  it("sends nothing about the person, the files' contents or where they are kept", async () => {
    const me = await sessionFor("one@example.test");
    await seedProfile(me.accountId);
    await seedVault(me.accountId);
    await draftFor(me, await seedTor());

    const sent = JSON.stringify(generate.mock.calls);
    for (const private_ of ["one@example.test", "สมชาย", "ใจดี", me.accountId, "secret-key", "abc123hash", "vault/"]) {
      expect(sent).not.toContain(private_);
    }
  });

  it("stores nothing: no collection gains a row", async () => {
    const me = await sessionFor("one@example.test");
    await seedProfile(me.accountId);
    const torId = await seedTor();
    const before = (await db.listCollections().toArray()).map((item) => item.name).sort();

    await draftFor(me, torId);

    expect((await db.listCollections().toArray()).map((item) => item.name).sort()).toEqual(before);
    expect(await vaultDocuments(db).countDocuments({})).toBe(0);
  });

  it("is off, and as good as absent, unless DRAFT_ENABLED", async () => {
    app = buildApp({ enabled: false });
    const me = await sessionFor("one@example.test");
    await seedProfile(me.accountId);

    expect((await draftFor(me, await seedTor())).status).toBe(404);
    expect(generate).not.toHaveBeenCalled();
  });

  it("refuses without a session or from another origin, and for an unknown, malformed or restricted TOR", async () => {
    const me = await sessionFor("one@example.test");
    await seedProfile(me.accountId);
    const torId = await seedTor();

    expect((await request(app).post(`/api/v1/me/tors/${torId}/draft`).set("origin", config.appOrigin)).status).toBe(401);
    expect((await request(app).post(`/api/v1/me/tors/${torId}/draft`).set("x-session-id", me.session).set("origin", "https://evil.example")).status).toBe(403);
    expect((await draftFor(me, new ObjectId().toString())).status).toBe(404);
    expect((await draftFor(me, "not-an-id")).status).toBe(404);
    expect((await draftFor(me, await seedTor(true))).status).toBe(404);
    expect(generate).not.toHaveBeenCalled();
  });

  it("asks for the profile first rather than drafting from nothing", async () => {
    const me = await sessionFor("one@example.test");
    const torId = await seedTor();
    await seedProfile(me.accountId, []);

    const response = await draftFor(me, torId);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("profile_needed");
    expect(generate).not.toHaveBeenCalled();
  });

  it("answers 502 when the model fails, and logs the reason but never what was sent", async () => {
    const me = await sessionFor("one@example.test");
    await seedProfile(me.accountId);
    generate.mockRejectedValueOnce(new GenerationError("vertex generateContent failed: 503"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await draftFor(me, await seedTor());

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("draft_failed");
    expect(JSON.stringify(warn.mock.calls)).toContain("503");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("จ้างก่อสร้าง");
  });

  it("limits each account per hour, and one account's drafts do not use up another's", async () => {
    app = buildApp({ ratePerHour: 2 });
    const one = await sessionFor("one@example.test");
    const two = await sessionFor("two@example.test");
    await seedProfile(one.accountId);
    await seedProfile(two.accountId);
    const torId = await seedTor();

    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await draftFor(one, torId)).status);

    expect(statuses).toEqual([200, 200, 429]);
    expect((await draftFor(two, torId)).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(3);
  });
});
