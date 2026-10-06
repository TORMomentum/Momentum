import "../../test/env.js";

import express from "express";
import type { Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LogMailer } from "../../adapters/log.mailer.js";
import { loadConfig } from "../../core/config.js";
import { accounts, accountTokens, bookmarks, connect, disconnect, ensureIndexes, sessions, tors } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { sessionContext } from "../../core/session-context.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountTokensRepository } from "./account-tokens.repository.js";
import { AccountsRepository } from "./accounts.repository.js";
import { buildAccountsRouter } from "./accounts.routes.js";
import { SessionsRepository } from "./sessions.js";

const baseConfig = loadConfig(process.env);
const config = {
  ...baseConfig,
  authRateLimitPerIp: Math.max(baseConfig.authRateLimitPerIp, 1_000),
  authRateLimitPerEmail: Math.max(baseConfig.authRateLimitPerEmail, 1_000),
};
let db: Db;
let mailer: LogMailer;
let app: express.Express;

function buildTestApp() {
  const sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs);
  const accountsRepository = new AccountsRepository(db, sessionsRepository);
  const tokensRepository = new AccountTokensRepository(db);
  const testApp = express();
  testApp.use(express.json());
  testApp.use(sessionContext(sessionsRepository));
  testApp.use("/api/v1", buildAccountsRouter({
    config,
    accounts: accountsRepository,
    tokens: tokensRepository,
    sessions: sessionsRepository,
    mailer,
  }));
  testApp.use(errorMiddleware);
  return testApp;
}

function write(requestBuilder: request.Test) {
  return requestBuilder.set("origin", config.appOrigin);
}

function tokenFromLastEmail(): string {
  const text = mailer.messages.at(-1)?.text;
  if (!text) throw new Error("Expected an email");
  const url = text.split("\n").find((line) => line.startsWith(config.appOrigin));
  if (!url) throw new Error("Expected an action URL in the email");
  const token = new URL(url).searchParams.get("token");
  if (!token) throw new Error("Expected a token in the action URL");
  return token;
}

async function register(email = "vendor@example.test", password = "correct-password") {
  return write(request(app).post("/api/v1/register")).send({
    email,
    password,
    displayName: "Vendor",
    consent: true,
  });
}

async function verifyLastEmail() {
  return write(request(app).post("/api/v1/verify")).send({ token: tokenFromLastEmail() });
}

async function verifiedAccount(email = "vendor@example.test", password = "correct-password") {
  await register(email, password);
  await verifyLastEmail();
}

async function login(email = "vendor@example.test", password = "correct-password") {
  return write(request(app).post("/api/v1/login")).send({ email, password });
}

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "accounts-routes"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  await Promise.all([
    accounts(db).deleteMany({}),
    accountTokens(db).deleteMany({}),
    sessions(db).deleteMany({}),
    bookmarks(db).deleteMany({}),
    tors(db).deleteMany({}),
  ]);
  mailer = new LogMailer();
  app = buildTestApp();
});

afterAll(async () => {
  await disconnect();
});

describe("account routes", () => {
  it("register creates an account that is not yet verified, records consent, and sends one email", async () => {
    const response = await register();
    const stored = await accounts(db).findOne({ email: "vendor@example.test" });

    expect(response.status).toBe(202);
    expect(stored).toMatchObject({
      consent: { noticeVersion: config.consentNotice.version, noticeHash: config.consentNotice.hash, action: "checkbox" },
    });
    expect(stored?.emailVerifiedAt).toBeUndefined();
    expect(stored?.consent.agreedAt).toBeInstanceOf(Date);
    expect(mailer.messages).toHaveLength(1);
  });

  it("register with consent absent or false is rejected and creates nothing", async () => {
    const absent = await write(request(app).post("/api/v1/register")).send({ email: "absent@example.test", password: "correct-password" });
    const falseConsent = await write(request(app).post("/api/v1/register")).send({ email: "false@example.test", password: "correct-password", consent: false });

    expect(absent.status).toBe(400);
    expect(falseConsent.status).toBe(400);
    expect(await accounts(db).countDocuments({})).toBe(0);
    expect(mailer.messages).toHaveLength(0);
  });

  it("registering an address with a verified account creates no second account, returns the fresh reply, and sends one email", async () => {
    const fresh = await register();
    await verifyLastEmail();
    mailer.messages.splice(0);

    const repeated = await register();

    expect(repeated.status).toBe(fresh.status);
    expect(repeated.body).toEqual(fresh.body);
    expect(await accounts(db).countDocuments({ email: "vendor@example.test" })).toBe(1);
    expect(mailer.messages).toHaveLength(1);
  });

  it("registering an unverified address creates no second account and sends a fresh verification link", async () => {
    await register();
    const firstToken = tokenFromLastEmail();

    await register();

    expect(await accounts(db).countDocuments({ email: "vendor@example.test" })).toBe(1);
    expect(mailer.messages).toHaveLength(2);
    expect(tokenFromLastEmail()).not.toBe(firstToken);
  });

  it("an unverified account receives the same failed sign-in reply as wrong credentials and an unknown address", async () => {
    await register();
    const unverified = await login();
    const wrongPassword = await login("vendor@example.test", "wrong-password");
    const unknown = await login("unknown@example.test", "wrong-password");

    expect(unverified.status).toBe(401);
    expect(wrongPassword.status).toBe(unverified.status);
    expect(wrongPassword.body).toEqual(unverified.body);
    expect(unknown.status).toBe(unverified.status);
    expect(unknown.body).toEqual(unverified.body);
  });

  it("verify marks the account verified and rejects a token used twice", async () => {
    await register();
    const token = tokenFromLastEmail();
    const verified = await write(request(app).post("/api/v1/verify")).send({ token });
    const repeated = await write(request(app).post("/api/v1/verify")).send({ token });

    expect(verified.status).toBe(200);
    expect((await accounts(db).findOne({ email: "vendor@example.test" }))?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(repeated.status).toBe(401);
  });

  it("verify and reset reject missing or malformed tokens", async () => {
    const missingVerify = await write(request(app).post("/api/v1/verify")).send({});
    const malformedVerify = await write(request(app).post("/api/v1/verify")).send({ token: "" });
    const missingReset = await write(request(app).post("/api/v1/password/reset")).send({ password: "new-password" });
    const malformedReset = await write(request(app).post("/api/v1/password/reset")).send({ token: "", password: "new-password" });

    expect(missingVerify.status).toBe(400);
    expect(malformedVerify.status).toBe(400);
    expect(missingReset.status).toBe(400);
    expect(malformedReset.status).toBe(400);
  });

  it("login creates a session that me resolves and logout removes it", async () => {
    await verifiedAccount();
    const signedIn = await login();
    const sessionId = signedIn.body.sessionId as string;
    const me = await request(app).get("/api/v1/me").set("x-session-id", sessionId);
    const loggedOut = await write(request(app).post("/api/v1/logout")).set("x-session-id", sessionId).send({});
    const afterLogout = await request(app).get("/api/v1/me").set("x-session-id", sessionId);

    expect(signedIn.status).toBe(200);
    expect(me.status).toBe(200);
    expect(loggedOut.status).toBe(200);
    expect(afterLogout.status).toBe(401);
  });

  it("password forgot gives known and unknown addresses the same reply but emails only the known address", async () => {
    await verifiedAccount();
    mailer.messages.splice(0);
    const known = await write(request(app).post("/api/v1/password/forgot")).send({ email: "vendor@example.test" });
    const unknown = await write(request(app).post("/api/v1/password/forgot")).send({ email: "unknown@example.test" });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(mailer.messages).toHaveLength(1);
  });

  it("password reset sets a new password, permits sign-in, and revokes every existing session", async () => {
    await verifiedAccount();
    const firstSession = (await login()).body.sessionId as string;
    const secondSession = (await login()).body.sessionId as string;
    await write(request(app).post("/api/v1/password/forgot")).send({ email: "vendor@example.test" });
    const reset = await write(request(app).post("/api/v1/password/reset")).send({ token: tokenFromLastEmail(), password: "new-password" });
    const signedIn = await login("vendor@example.test", "new-password");

    expect(reset.status).toBe(200);
    expect(signedIn.status).toBe(200);
    expect((await request(app).get("/api/v1/me").set("x-session-id", firstSession)).status).toBe(401);
    expect((await request(app).get("/api/v1/me").set("x-session-id", secondSession)).status).toBe(401);
  });

  it("password change requires the current password and revokes every session except its own", async () => {
    await verifiedAccount();
    const firstSession = (await login()).body.sessionId as string;
    const secondSession = (await login()).body.sessionId as string;
    const rejected = await write(request(app).post("/api/v1/password/change")).set("x-session-id", firstSession).send({ currentPassword: "wrong-password", password: "new-password" });
    const changed = await write(request(app).post("/api/v1/password/change")).set("x-session-id", firstSession).send({ currentPassword: "correct-password", password: "new-password" });

    expect(rejected.status).toBe(401);
    expect(changed.status).toBe(200);
    expect((await request(app).get("/api/v1/me").set("x-session-id", firstSession)).status).toBe(200);
    expect((await request(app).get("/api/v1/me").set("x-session-id", secondSession)).status).toBe(401);
  });

  it("an expired token is refused before Mongo TTL cleanup runs", async () => {
    await register();
    const account = await accounts(db).findOne({ email: "vendor@example.test" });
    const token = await new AccountTokensRepository(db).create(account!._id.toString(), "verify", -1);
    const response = await write(request(app).post("/api/v1/verify")).send({ token });

    expect(response.status).toBe(401);
  });

  it("verify and reset tokens are refused by each other's routes", async () => {
    await verifiedAccount();
    await write(request(app).post("/api/v1/password/forgot")).send({ email: "vendor@example.test" });
    const resetToken = tokenFromLastEmail();
    await register("other@example.test");
    const verifyToken = tokenFromLastEmail();
    const resetWithVerify = await write(request(app).post("/api/v1/password/reset")).send({ token: verifyToken, password: "new-password" });
    const verifyWithReset = await write(request(app).post("/api/v1/verify")).send({ token: resetToken });

    expect(resetWithVerify.status).toBe(401);
    expect(verifyWithReset.status).toBe(401);
  });

  it("me returns 401 without a session and the account with one", async () => {
    const anonymous = await request(app).get("/api/v1/me");
    await verifiedAccount();
    const signedIn = await login();
    const response = await request(app).get("/api/v1/me").set("x-session-id", signedIn.body.sessionId as string);

    expect(anonymous.status).toBe(401);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: "vendor@example.test", displayName: "Vendor", role: "vendor", emailVerifiedAt: expect.any(String) });
  });

  it("exports only the signed-in account's owned data without hashes, tokens, or session ids", async () => {
    await verifiedAccount();
    await verifiedAccount("other@example.test");
    const signedIn = await login();
    const account = await accounts(db).findOne({ email: "vendor@example.test" });
    const other = await accounts(db).findOne({ email: "other@example.test" });
    await bookmarks(db).insertMany([
      { accountId: account!._id.toString(), torId: "mine", createdAt: new Date() },
      { accountId: other!._id.toString(), torId: "theirs", createdAt: new Date() },
    ]);

    const response = await request(app).get("/api/v1/me/export").set("x-session-id", signedIn.body.sessionId as string);
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body.account.email).toBe("vendor@example.test");
    expect(response.body.account.consent).toMatchObject({ noticeVersion: config.consentNotice.version });
    expect(response.body.bookmarks).toHaveLength(1);
    expect(response.body.bookmarks[0].torId).toBe("mine");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("other@example.test");
    expect(serialized).not.toContain("theirs");
    expect(serialized).not.toContain(signedIn.body.sessionId as string);
  });

  it("deletion requires the current password and changes nothing when it is wrong", async () => {
    await verifiedAccount();
    const signedIn = await login();
    const account = await accounts(db).findOne({ email: "vendor@example.test" });
    await bookmarks(db).insertOne({ accountId: account!._id.toString(), torId: "mine", createdAt: new Date() });
    const rejected = await write(request(app).delete("/api/v1/me")).set("x-session-id", signedIn.body.sessionId as string).send({ currentPassword: "wrong-password" });

    expect(rejected.status).toBe(401);
    expect((await accounts(db).findOne({ _id: account!._id }))?.email).toBe("vendor@example.test");
    expect(await bookmarks(db).countDocuments({ accountId: account!._id.toString() })).toBe(1);
    expect(await sessions(db).countDocuments({ accountId: account!._id.toString() })).toBe(1);
  });

  it("deletion tombstones its account, revokes sessions, removes owned records, and leaves TORs untouched", async () => {
    await verifiedAccount();
    const first = await login();
    const second = await login();
    const account = await accounts(db).findOne({ email: "vendor@example.test" });
    await bookmarks(db).insertOne({ accountId: account!._id.toString(), torId: "mine", createdAt: new Date() });
    await tors(db).insertOne({
      contentHash: "delete-preserved-tor", storage: { bucket: "test", key: "tor", contentType: "application/pdf", bytes: 1 }, sourceRefs: [],
      pipeline: { state: "done", attempts: 1 }, fields: {}, announcedAt: null, sourceUrl: null, unverified: false,
      statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const beforeTors = await tors(db).countDocuments({});
    const deleted = await write(request(app).delete("/api/v1/me")).set("x-session-id", first.body.sessionId as string).send({ currentPassword: "correct-password" });
    const tombstone = await accounts(db).findOne({ _id: account!._id });

    expect(deleted.status).toBe(200);
    expect(tombstone?.deletedAt).toBeInstanceOf(Date);
    expect(tombstone?.email).toMatch(/^deleted:/);
    expect(await sessions(db).countDocuments({ accountId: account!._id.toString() })).toBe(0);
    expect(await bookmarks(db).countDocuments({ accountId: account!._id.toString() })).toBe(0);
    expect((await login()).status).toBe(401);
    expect((await request(app).get("/api/v1/me").set("x-session-id", second.body.sessionId as string)).status).toBe(401);
    expect(await tors(db).countDocuments({})).toBe(beforeTors);
  });
});
