import "../../test/env.js";

import { createHash } from "node:crypto";
import express from "express";
import type { Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LogMailer } from "../../adapters/log.mailer.js";
import { loadConfig } from "../../core/config.js";
import { accounts, accountTokens, connect, disconnect, ensureIndexes, googleSignups, oauthTransactions, sessions } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { sessionContext } from "../../core/session-context.js";
import type { GoogleIdentity, GoogleOidc } from "../../ports/google-oidc.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountTokensRepository } from "./account-tokens.repository.js";
import { AccountsRepository } from "./accounts.repository.js";
import { buildAccountsRouter } from "./accounts.routes.js";
import { GoogleSigninRepository } from "./google-signin.repository.js";
import { buildGoogleSigninRouter } from "./google-signin.routes.js";
import { GoogleSigninService, GOOGLE_FAILURE } from "./google-signin.service.js";
import { hashPassword } from "./password.js";
import { SessionsRepository } from "./sessions.js";

const baseConfig = loadConfig(process.env);
const config = {
  ...baseConfig,
  authRateLimitPerIp: 1_000,
  authRateLimitPerEmail: 1_000,
  googleOauth: { ...baseConfig.googleOauth, enabled: true, clientId: "client-1", clientSecret: "secret-1" },
};

/** Google, replaced: records what start sent, and answers `exchange` with whatever the test sets. */
class StubGoogle implements GoogleOidc {
  sent?: { state: string; nonce: string; codeChallenge: string };
  verifier?: string;
  /** Overrides applied to the identity the stub returns; `nonce` defaults to the one `start` sent. */
  claims: Partial<GoogleIdentity> = {};
  failExchange = false;

  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): string {
    this.sent = input;
    return `https://google.example.test/auth?state=${input.state}&code_challenge=${input.codeChallenge}`;
  }

  async exchange(input: { code: string; codeVerifier: string }): Promise<GoogleIdentity> {
    this.verifier = input.codeVerifier;
    if (this.failExchange) throw new Error("bad token");
    return { sub: "google-sub-1", email: "Vendor@Example.test", emailVerified: true, hostedDomain: "example.test", name: "Vendor G", nonce: this.sent?.nonce, ...this.claims };
  }
}

let db: Db;
let google: StubGoogle;
let mailer: LogMailer;
let app: express.Express;

function buildTestApp() {
  const sessionsRepository = new SessionsRepository(db, config.session);
  const accountsRepository = new AccountsRepository(db, sessionsRepository);
  const tokensRepository = new AccountTokensRepository(db);
  const testApp = express();
  testApp.use(express.json());
  testApp.use(sessionContext(sessionsRepository));
  testApp.use("/auth", buildGoogleSigninRouter({
    config,
    service: new GoogleSigninService({ config, mailer, oidc: google, repository: new GoogleSigninRepository(db), accounts: accountsRepository, tokens: tokensRepository, sessions: sessionsRepository }),
  }));
  testApp.use("/auth", buildAccountsRouter({ config, accounts: accountsRepository, tokens: tokensRepository, sessions: sessionsRepository, mailer: new LogMailer(), breachedPasswords: { occurrences: async () => 0 }, vault: { removeAll: async () => undefined } }));
  testApp.use(errorMiddleware);
  return testApp;
}

const post = (path: string) => request(app).post(path).set("origin", config.appOrigin);

async function start() {
  const response = await request(app).get("/auth/google/start");
  return { response, state: google.sent!.state, binding: response.body.binding as string };
}

async function callbackWith(overrides: Partial<{ code: string; state: string; binding: string }> = {}) {
  const started = await start();
  return post("/auth/google/callback").send({ code: "auth-code", state: started.state, binding: started.binding, ...overrides });
}

async function existingAccount(extra: Record<string, unknown> = {}) {
  const now = new Date();
  await accounts(db).insertOne({
    email: "vendor@example.test", displayName: "Existing", passwordHash: "x", emailVerifiedAt: now, role: "vendor",
    consent: { noticeVersion: "v", noticeHash: "h", agreedAt: now, action: "checkbox" }, createdAt: now, updatedAt: now, ...extra,
  });
}

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "google-signin"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  await Promise.all([accounts(db).deleteMany({}), accountTokens(db).deleteMany({}), sessions(db).deleteMany({}), oauthTransactions(db).deleteMany({}), googleSignups(db).deleteMany({})]);
  google = new StubGoogle();
  mailer = new LogMailer();
  app = buildTestApp();
});

afterAll(async () => {
  await disconnect();
});

describe("Google sign-in: start", () => {
  it("sends a PKCE challenge that matches the verifier it keeps, and a fresh state, nonce and browser binding", async () => {
    const { response, state, binding } = await start();
    const transaction = await oauthTransactions(db).findOne({});

    expect(response.status).toBe(200);
    expect(response.body.url).toContain("https://google.example.test/auth");
    expect(google.sent!.codeChallenge).toBe(createHash("sha256").update(transaction!.codeVerifier).digest("base64url"));
    expect(new Set([state, google.sent!.nonce, binding]).size).toBe(3);
    // Digests only: the stored row cannot be replayed as a state or a cookie.
    expect(transaction!._id).toBe(createHash("sha256").update(state).digest("hex"));
    expect(JSON.stringify(transaction)).not.toContain(binding);
  });
});

describe("Google sign-in: callback validation", () => {
  it("rejects a state that was never issued", async () => {
    const response = await callbackWith({ state: "forged" });
    expect(response.status).toBe(401);
    expect(response.body.message ?? response.body.error).toBeDefined();
    expect(await sessions(db).countDocuments({})).toBe(0);
  });

  it("rejects a callback from a different browser (binding mismatch) and burns the transaction", async () => {
    const started = await start();
    const wrong = await post("/auth/google/callback").send({ code: "c", state: started.state, binding: "someone-elses-cookie" });
    const retried = await post("/auth/google/callback").send({ code: "c", state: started.state, binding: started.binding });

    expect(wrong.status).toBe(401);
    expect(retried.status).toBe(401);
    expect(await sessions(db).countDocuments({})).toBe(0);
  });

  it("rejects a replayed callback: a transaction is single use", async () => {
    await existingAccount({ google: { sub: "google-sub-1" } });
    const started = await start();
    const body = { code: "c", state: started.state, binding: started.binding };

    expect((await post("/auth/google/callback").send(body)).status).toBe(200);
    expect((await post("/auth/google/callback").send(body)).status).toBe(401);
  });

  it("rejects a nonce that is not the one stored", async () => {
    await existingAccount();
    google.claims = { nonce: "another-nonce" };
    expect((await callbackWith()).status).toBe(401);
    google.claims = { nonce: undefined };
    expect((await callbackWith()).status).toBe(401);
    expect(await sessions(db).countDocuments({})).toBe(0);
  });

  it("rejects when Google's token fails validation (bad audience, issuer, signature or expiry)", async () => {
    await existingAccount();
    google.failExchange = true;
    const response = await callbackWith();
    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).toContain(GOOGLE_FAILURE);
  });

  it("passes the PKCE verifier it stored to the code exchange", async () => {
    await existingAccount();
    await callbackWith();
    const challenge = createHash("sha256").update(google.verifier!).digest("base64url");
    expect(challenge).toBe(google.sent!.codeChallenge);
  });

  it("refuses a foreign origin and a body without a code", async () => {
    expect((await request(app).post("/auth/google/callback").set("origin", "https://evil.example.test").send({ code: "c", state: "s", binding: "b" })).status).toBe(403);
    expect((await post("/auth/google/callback").send({ state: "s", binding: "b" })).status).toBe(400);
  });
});

describe("Google sign-in: accounts", () => {
  it("links to an existing VERIFIED account with the same address, stores the sub, and issues a session", async () => {
    const passwordHash = await hashPassword("correct-password", config);
    await existingAccount({ passwordHash });
    expect((await callbackWith()).status).toBe(401);
    expect((await accounts(db).findOne({}))?.google).toBeUndefined();
    expect(await sessions(db).countDocuments({})).toBe(0);
    const login = await post("/auth/login").send({ email: "vendor@example.test", password: "correct-password" }).expect(200);
    const oldSession = login.body.sessionId;
    const started = await request(app).get("/auth/google/start").set("x-session-id", oldSession).expect(200);
    await post("/auth/google/callback").send({ code: "auth-code", state: google.sent!.state, binding: started.body.binding }).expect(401);
    expect((await accounts(db).findOne({}))?.google).toBeUndefined();
    const retry = await request(app).get("/auth/google/start").set("x-session-id", oldSession).expect(200);
    const response = await post("/auth/google/callback").set("x-session-id", oldSession)
      .send({ code: "auth-code", state: google.sent!.state, binding: retry.body.binding }).expect(200);
    expect(await accounts(db).findOne({ email: "vendor@example.test" })).toMatchObject({ google: { sub: "google-sub-1" }, passwordHash });
    await request(app).get("/auth/me").set("x-session-id", oldSession).expect(401);
    const me = await request(app).get("/auth/me").set("x-session-id", response.body.sessionId);
    expect(me.body.email).toBe("vendor@example.test");
  });

  it("matches by sub once linked, even if the address at Google has changed", async () => {
    await existingAccount({ google: { sub: "google-sub-1" } });
    google.claims = { email: "renamed@example.test" };
    const response = await callbackWith();

    expect(response.body.status).toBe("signed_in");
    expect(await accounts(db).countDocuments({})).toBe(1);
  });

  it("never links on an address Google does not vouch for, and creates nothing", async () => {
    await existingAccount();
    google.claims = { emailVerified: false };
    const response = await callbackWith();

    expect(response.status).toBe(401);
    expect((await accounts(db).findOne({}))?.google).toBeUndefined();
    expect(await googleSignups(db).countDocuments({})).toBe(0);
  });

  it("does not link to a password account that never verified its address, and replaces it after consent", async () => {
    await existingAccount({ emailVerifiedAt: undefined, passwordHash: "attacker-chosen" });
    await accounts(db).updateOne({}, { $unset: { emailVerifiedAt: "" } });
    const callback = await callbackWith();

    expect(callback.body.status).toBe("consent_required");
    expect((await accounts(db).findOne({}))?.google).toBeUndefined();

    const complete = await post("/auth/google/complete").send({ ticket: callback.body.ticket, consent: true });
    expect(complete.body.status).toBe("signed_in");
    const stored = await accounts(db).find({}).toArray();
    expect(stored).toHaveLength(1);
    // The attacker's password did not survive: the account is the Google owner's.
    expect(stored[0]).toMatchObject({ google: { sub: "google-sub-1" }, emailVerifiedAt: expect.any(Date) });
    expect(stored[0]!.passwordHash).toBeUndefined();
  });

  it("refuses an address whose account is already linked to a different Google identity", async () => {
    await existingAccount({ google: { sub: "another-sub" } });
    expect((await callbackWith()).status).toBe(401);
  });

  it("refuses a disabled account, whether it is found by sub or by address", async () => {
    await existingAccount({ google: { sub: "google-sub-1" }, disabledAt: new Date() });
    expect((await callbackWith()).status).toBe(401);
    await accounts(db).deleteMany({});
    await existingAccount({ disabledAt: new Date() });
    expect((await callbackWith()).status).toBe(401);
    expect(await sessions(db).countDocuments({})).toBe(0);
  });

  it("does not sign in a deleted account: its sub is gone and its address is a tombstone", async () => {
    await existingAccount({ google: { sub: "google-sub-1" } });
    const sessionsRepository = new SessionsRepository(db, config.session);
    const stored = await accounts(db).findOne({});
    await new AccountsRepository(db, sessionsRepository).softDelete(stored!._id.toString());

    const callback = await callbackWith();
    // Falls through to the new-account path, which needs consent, so nothing is signed in.
    expect(callback.body.status).toBe("consent_required");
    expect(await sessions(db).countDocuments({})).toBe(0);
  });
});

describe("Google sign-in: first sign-in needs PDPA consent", () => {
  it("requires fresh mailbox proof and the browser ticket for an external Google address without hd", async () => {
    google.claims = { hostedDomain: undefined, emailVerified: true };
    const first = await callbackWith();
    expect(first.body.checkMailbox).toBe(true);
    await post("/auth/google/complete").send({ ticket: first.body.ticket, consent: true }).expect(401);
    await post("/auth/password/forgot").send({ email: "vendor@example.test" });
    expect(await accountTokens(db).countDocuments({ purpose: "reset" })).toBe(0);
    expect(await accounts(db).countDocuments({})).toBe(0);
    const second = await callbackWith();
    const link = new URL(mailer.messages.at(-1)!.text.trim().split("\n").at(-1)!);
    const proof = new URLSearchParams(link.hash.slice(1)).get("proof");
    expect(proof).toBeTruthy();
    expect(JSON.stringify(second.body)).not.toContain(proof);
    await post("/auth/google/complete").send({ ticket: second.body.ticket, consent: true, proof }).expect(200);
    expect((await accounts(db).findOne({}))?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("accepts a verified Gmail mailbox without a hosted domain", async () => {
    google.claims = { email: "vendor@gmail.com", hostedDomain: undefined };
    const callback = await callbackWith();
    expect(callback.body.checkMailbox).toBeUndefined();
    await post("/auth/google/complete").send({ ticket: callback.body.ticket, consent: true }).expect(200);
    expect(mailer.messages).toHaveLength(0);
  });

  it("creates no account until consent is given, then records the same consent a password sign-up does", async () => {
    const callback = await callbackWith();
    expect(callback.body.status).toBe("consent_required");
    expect(await accounts(db).countDocuments({})).toBe(0);
    expect(await sessions(db).countDocuments({})).toBe(0);

    const complete = await post("/auth/google/complete").send({ ticket: callback.body.ticket, consent: true, behaviourConsent: true });
    const stored = await accounts(db).findOne({ email: "vendor@example.test" });

    expect(complete.body.status).toBe("signed_in");
    expect(stored).toMatchObject({
      displayName: "Vendor G", google: { sub: "google-sub-1" }, role: "vendor",
      consent: { noticeVersion: config.consentNotice.version, noticeHash: config.consentNotice.hash, action: "checkbox" },
      behaviourConsent: { agreedAt: expect.any(Date) },
    });
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(stored?.passwordHash).toBeUndefined();
  });

  it("refuses the consent step without consent, and a ticket can be used only once", async () => {
    const callback = await callbackWith();
    expect((await post("/auth/google/complete").send({ ticket: callback.body.ticket, consent: false })).status).toBe(400);
    expect((await post("/auth/google/complete").send({ ticket: callback.body.ticket })).status).toBe(400);
    expect(await accounts(db).countDocuments({})).toBe(0);

    expect((await post("/auth/google/complete").send({ ticket: callback.body.ticket, consent: true })).status).toBe(200);
    expect((await post("/auth/google/complete").send({ ticket: callback.body.ticket, consent: true })).status).toBe(401);
  });

  it("refuses an unknown ticket", async () => {
    expect((await post("/auth/google/complete").send({ ticket: "nope", consent: true })).status).toBe(401);
  });
});

describe("Google-only accounts across the account routes", () => {
  async function googleOnlySession() {
    const callback = await callbackWith();
    const complete = await post("/auth/google/complete").send({ ticket: callback.body.ticket, consent: true });
    return complete.body.sessionId as string;
  }

  it("cannot sign in with a password, and the failure looks like any other", async () => {
    await googleOnlySession();
    const known = await post("/auth/login").send({ email: "vendor@example.test", password: "whatever-pass" });
    const unknown = await post("/auth/login").send({ email: "nobody@example.test", password: "whatever-pass" });
    expect(known.status).toBe(401);
    expect(known.body).toEqual(unknown.body);
  });

  it("cannot change a password it does not have, and deletion says how to set one", async () => {
    const sessionId = await googleOnlySession();
    const change = await post("/auth/password/change").set("x-session-id", sessionId).send({ currentPassword: "x", password: "new-password-1" });
    const removal = await request(app).delete("/auth/me").set("origin", config.appOrigin).set("x-session-id", sessionId).send({ currentPassword: "x" });

    expect(change.status).toBe(401);
    expect(removal.status).toBe(400);
    expect(JSON.stringify(removal.body)).toContain("ลืมรหัสผ่าน");
    expect((await accounts(db).findOne({}))?.deletedAt).toBeUndefined();
  });

  it("exports its data (including the Google subject, but no password hash) and may set a password by email reset", async () => {
    const sessionId = await googleOnlySession();
    const exported = await request(app).get("/auth/me/export").set("x-session-id", sessionId);
    expect(exported.status).toBe(200);
    expect(exported.body.account.google).toEqual({ sub: "google-sub-1" });
    expect(JSON.stringify(exported.body)).not.toContain("passwordHash");

    await post("/auth/password/forgot").send({ email: "vendor@example.test" });
    expect(await accountTokens(db).countDocuments({ purpose: "reset" })).toBe(1);
  });
});
