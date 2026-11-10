import "../../test/env.js";
import express from "express";
import type { Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../../core/config.js";
import { accounts, connect, disconnect, ensureIndexes, sessions, vaultDocuments } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { sessionContext } from "../../core/session-context.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { MemoryVaultStorage } from "../../test/memory-vault-storage.js";
import { AccountsRepository } from "../accounts/accounts.repository.js";
import { SessionsRepository } from "../accounts/sessions.js";
import { hashPassword } from "../accounts/password.js";
import { VaultRepository } from "./vault.repository.js";
import { VaultService } from "./vault.service.js";
import { buildVaultRouter } from "./vault.routes.js";

const baseConfig = loadConfig(process.env);
let config: Config;
let db: Db;
let storage: MemoryVaultStorage;
let sessionsRepository: SessionsRepository;
let accountsRepository: AccountsRepository;
let app: express.Express;

const PDF = Buffer.from("%PDF-1.4\nการทดสอบ\n%%EOF");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);

function buildApp(overrides: Partial<Config["vault"]> = {}) {
  config = { ...baseConfig, vault: { ...baseConfig.vault, ...overrides } };
  const repo = new VaultRepository(db);
  const result = express();
  result.use(express.json());
  result.use(sessionContext(sessionsRepository));
  result.use("/api/v1", buildVaultRouter({ config, vault: repo, service: new VaultService(repo, storage), storage }));
  result.use(errorMiddleware);
  return result;
}

async function sessionFor(email: string): Promise<{ session: string; accountId: string }> {
  const created = await accountsRepository.create({
    email, displayName: "ผู้ขาย", passwordHash: await hashPassword("correct-password", config),
    consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox" },
  });
  return { session: (await sessionsRepository.create(created.id)).id, accountId: created.id };
}

/** An upload as the browser sends it: the text fields and one file, as multipart. */
function upload(who: { session: string }, file: Buffer | null, fields: Record<string, string> = { kind: "cv" }, filename = "cv.pdf") {
  let req = request(app).post("/api/v1/me/vault").set("x-session-id", who.session).set("origin", config.appOrigin);
  for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
  if (file) req = req.attach("file", file, { filename, contentType: "application/octet-stream" });
  return req;
}

beforeAll(async () => {
  db = await connect(isolatedDbUrl(baseConfig.mongoUrl, "vault-routes"));
  await ensureIndexes(db);
  sessionsRepository = new SessionsRepository(db, baseConfig.session.lifetimeMs);
  accountsRepository = new AccountsRepository(db, sessionsRepository);
});
beforeEach(async () => {
  await Promise.all([accounts(db).deleteMany({}), sessions(db).deleteMany({}), vaultDocuments(db).deleteMany({})]);
  storage = new MemoryVaultStorage();
  app = buildApp();
});
afterAll(async () => { await disconnect(); });

describe("vendor document vault (TOR-218)", () => {
  it("stores a file under the vendor's own key, lists it, and hands the same bytes back as an attachment", async () => {
    const me = await sessionFor("one@example.test");
    const created = await upload(me, PDF, { kind: "cv" }, "ประวัติบริษัท.pdf");

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "cv", filename: "ประวัติบริษัท.pdf", contentType: "application/pdf", bytes: PDF.byteLength });
    expect(JSON.stringify(created.body)).not.toMatch(/vault\//); // the storage key is never shown
    const [key] = [...storage.objects.keys()];
    expect(key).toMatch(new RegExp(`^vault/${me.accountId}/`));

    const listed = await request(app).get("/api/v1/me/vault").set("x-session-id", me.session);
    expect(listed.body.documents).toHaveLength(1);
    expect(listed.body.limits).toEqual({ maxFileBytes: config.vault.maxFileBytes, maxFiles: config.vault.maxFiles });

    const file = await request(app).get(`/api/v1/me/vault/${created.body.id}/file`).set("x-session-id", me.session).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(file.body).toEqual(PDF);
    expect(file.headers["content-disposition"]).toMatch(/^attachment/);
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["cache-control"]).toContain("no-store");
  });

  it("decides the type from the bytes, not from what the sender called the file", async () => {
    const me = await sessionFor("one@example.test");
    const text = await upload(me, Buffer.from("just some text, called .pdf"), { kind: "cv" }, "fake.pdf");
    const png = await upload(me, PNG, { kind: "past_work" }, "work.pdf");

    expect(text.status).toBe(400);
    expect(png.status).toBe(201);
    expect(png.body.contentType).toBe("image/png");
    expect(storage.objects.size).toBe(1);
  });

  it("refuses an empty file, a missing file, a missing or unknown type and an unknown certificate, storing nothing", async () => {
    const me = await sessionFor("one@example.test");
    const attempts = [
      await upload(me, Buffer.alloc(0), { kind: "cv" }),
      await upload(me, null, { kind: "cv" }),
      await upload(me, PDF, {}),
      await upload(me, PDF, { kind: "passport" }),
      await upload(me, PDF, { kind: "certificate", certificationId: "made-up" }),
    ];
    expect(attempts.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
    expect(storage.objects.size).toBe(0);
    expect(await vaultDocuments(db).countDocuments({})).toBe(0);
  });

  it("keeps which certificate a file is only for certificates", async () => {
    const me = await sessionFor("one@example.test");
    const cert = await upload(me, PDF, { kind: "certificate", certificationId: "iso-9001" });
    const cv = await upload(me, PDF, { kind: "cv", certificationId: "iso-9001" });

    expect(cert.body.certificationId).toBe("iso-9001");
    expect(cv.body.certificationId).toBeUndefined();
  });

  it("refuses a file over the size cap and a full vault", async () => {
    const me = await sessionFor("one@example.test");
    app = buildApp({ maxFileBytes: 64, maxFiles: 2 });

    const big = await upload(me, Buffer.concat([PDF, Buffer.alloc(200)]));
    expect(big.status).toBe(413);

    expect((await upload(me, PDF)).status).toBe(201);
    expect((await upload(me, PDF)).status).toBe(201);
    const third = await upload(me, PDF);
    expect(third.status).toBe(409);
    expect(await vaultDocuments(db).countDocuments({})).toBe(2);
    expect(storage.objects.size).toBe(2);
  });

  it("is signed-in only and same-origin only for changes", async () => {
    const me = await sessionFor("one@example.test");
    expect((await request(app).get("/api/v1/me/vault")).status).toBe(401);
    expect((await request(app).post("/api/v1/me/vault").set("origin", config.appOrigin).field("kind", "cv").attach("file", PDF, "a.pdf")).status).toBe(401);

    const created = await upload(me, PDF);
    const noOrigin = await request(app).post("/api/v1/me/vault").set("x-session-id", me.session).field("kind", "cv").attach("file", PDF, "a.pdf");
    const noOriginDelete = await request(app).delete(`/api/v1/me/vault/${created.body.id}`).set("x-session-id", me.session);
    expect(noOrigin.status).toBe(403);
    expect(noOriginDelete.status).toBe(403);
    expect(await vaultDocuments(db).countDocuments({})).toBe(1);
  });

  it("keeps one vendor's files from another: list, download and delete all see nothing", async () => {
    const mine = await sessionFor("one@example.test");
    const other = await sessionFor("two@example.test");
    const created = await upload(mine, PDF);

    expect((await request(app).get("/api/v1/me/vault").set("x-session-id", other.session)).body.documents).toEqual([]);
    expect((await request(app).get(`/api/v1/me/vault/${created.body.id}/file`).set("x-session-id", other.session)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/me/vault/${created.body.id}`).set("x-session-id", other.session).set("origin", config.appOrigin)).status).toBe(404);
    expect((await request(app).get("/api/v1/me/vault/not-an-id/file").set("x-session-id", mine.session)).status).toBe(404);
    expect(storage.objects.size).toBe(1);
  });

  it("deletes the file and its record; a storage failure leaves both so the delete can be retried", async () => {
    const me = await sessionFor("one@example.test");
    const created = await upload(me, PDF);
    const del = () => request(app).delete(`/api/v1/me/vault/${created.body.id}`).set("x-session-id", me.session).set("origin", config.appOrigin);

    storage.failDelete = true;
    expect((await del()).status).toBe(500);
    expect(storage.objects.size).toBe(1);
    expect(await vaultDocuments(db).countDocuments({})).toBe(1);

    storage.failDelete = false;
    expect((await del()).status).toBe(200);
    expect(storage.objects.size).toBe(0);
    expect(await vaultDocuments(db).countDocuments({})).toBe(0);
    expect((await del()).status).toBe(404);
  });

  it("records nothing when storage refuses the file", async () => {
    const me = await sessionFor("one@example.test");
    storage.failPut = true;
    expect((await upload(me, PDF)).status).toBe(500);
    expect(await vaultDocuments(db).countDocuments({})).toBe(0);
  });

  it("removeAll deletes every file of one account and none of another's; a failure keeps the records", async () => {
    const mine = await sessionFor("one@example.test");
    const other = await sessionFor("two@example.test");
    await upload(mine, PDF);
    await upload(mine, PNG, { kind: "past_work" });
    await upload(other, PDF);
    const service = new VaultService(new VaultRepository(db), storage);

    storage.failDelete = true;
    await expect(service.removeAll(mine.accountId)).rejects.toThrow();
    expect(await vaultDocuments(db).countDocuments({ accountId: mine.accountId })).toBe(2);

    storage.failDelete = false;
    await service.removeAll(mine.accountId);
    expect(await vaultDocuments(db).countDocuments({ accountId: mine.accountId })).toBe(0);
    expect(await vaultDocuments(db).countDocuments({ accountId: other.accountId })).toBe(1);
    expect(storage.objects.size).toBe(1);
  });

  it("the account export lists what is kept (not the files, not the storage key)", async () => {
    const me = await sessionFor("one@example.test");
    await upload(me, PDF, { kind: "certificate", certificationId: "iso-9001" }, "iso.pdf");

    const exported = await accountsRepository.exportOwnedData(me.accountId);
    expect(exported.vaultDocuments).toHaveLength(1);
    expect(exported.vaultDocuments[0]).toMatchObject({ kind: "certificate", certificationId: "iso-9001", filename: "iso.pdf" });
    expect(JSON.stringify(exported.vaultDocuments)).not.toContain("vault/");
  });
});
