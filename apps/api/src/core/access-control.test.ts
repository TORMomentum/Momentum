import "../test/env.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { ObjectId, type Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Storage as GcsClient } from "@google-cloud/storage";
import { WORK_CATEGORIES } from "@tor-radar/seeds";
import { GcsVaultStorage } from "../adapters/gcs.vault.storage.js";
import { API_PREFIX, buildApp } from "../app.js";
import { AccountsRepository } from "../modules/accounts/accounts.repository.js";
import { hashPassword } from "../modules/accounts/password.js";
import { SessionsRepository } from "../modules/accounts/sessions.js";
import { loadConfig, type Config } from "./config.js";
import { accounts, behaviourEvents, bookmarks, connect, disconnect, ensureIndexes, sessions, tors, vaultDocuments, vendorProfiles } from "./db.js";
import { isolatedDbUrl } from "../test/mongo.js";

/**
 * T08 / ASVS V8.1.1 evidence: the access matrix in docs/security/access-control-matrix.md is the list of
 * routes and who may call them, and this file proves it. The route list is read from the matrix and compared with
 * the routers `buildApp` really mounts, so a route added without a matrix row (or a row left behind) fails here.
 */
type Caller = "public" | "vendor" | "admin-key" | "intake-key";
interface Row { method: string; path: string; caller: Caller }

const MATRIX = fileURLToPath(new URL("../../../../docs/security/access-control-matrix.md", import.meta.url));
const CALLERS = new Set<string>(["public", "vendor", "admin-key", "intake-key"]);

/** Rows of the API table: `| METHOD | `path` | caller | ...`. The web tables start with a path, so they never match. */
function matrixRows(): Row[] {
  const rows: Row[] = [];
  for (const line of readFileSync(MATRIX, "utf8").split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());
    const [, method, path, caller] = cells;
    if (!method || !/^(GET|HEAD|POST|PUT|PATCH|DELETE)$/.test(method) || !path?.startsWith("`") || !caller) continue;
    if (!CALLERS.has(caller)) throw new Error(`matrix row ${method} ${path}: unknown caller "${caller}"`);
    rows.push({ method, path: path.replaceAll("`", ""), caller: caller as Caller });
  }
  return rows;
}

/** Every route the real app registers, as `METHOD /full/path`. `/auth` mirrors the versioned mount, so it is folded in. */
function mountedRoutes(mounts: Array<{ prefix: string; router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } }>): Set<string> {
  const found = new Set<string>();
  for (const { prefix, router } of mounts) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const base = prefix === "/auth" ? API_PREFIX : prefix;
      const path = layer.route.path === "/" ? base : `${base}${layer.route.path}`;
      for (const method of Object.keys(layer.route.methods)) if (method !== "_all") found.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return found;
}

const baseConfig = loadConfig(process.env);
// Sign-in throttling is not under test; behaviour recording is switched on so A has events to protect.
const config: Config = {
  ...baseConfig,
  authRateLimitPerIp: 10_000,
  authRateLimitPerEmail: 10_000,
  mail: { ...baseConfig.mail, smtpUrl: undefined },
  // its own bucket, so this file never touches the vault of a running stack
  gcs: { ...baseConfig.gcs, vaultBucket: `${baseConfig.gcs.vaultBucket}-access-test` },
  matching: { ...baseConfig.matching, behaviour: { ...baseConfig.matching.behaviour, enabled: true } },
};

let db: Db;
let app: Express;
let sessionsRepository: SessionsRepository;
let mounted: Set<string>;

const FILL: Record<string, string> = { id: "0123456789abcdef01234567", torId: "0123456789abcdef01234567", projectId: "1", page: "1", field: "title" };
const concrete = (path: string) => path.replace(/:(\w+)/g, (_m, name: string) => FILL[name] ?? "x");

async function vendor(email: string, displayName: string) {
  const account = await new AccountsRepository(db, sessionsRepository).create({
    email, displayName, passwordHash: await hashPassword("correct-password", config),
    consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox" },
  });
  return { accountId: account.id, email, displayName, session: (await sessionsRepository.create(account.id)).id };
}
type Vendor = Awaited<ReturnType<typeof vendor>>;

/** A request as the Next server forwards it: the session in a header, and the app's own Origin on a write. */
function as(who: Vendor | null, method: string, path: string) {
  let req = request(app)[method.toLowerCase() as "get"](path).set("origin", config.appOrigin);
  if (who) req = req.set("x-session-id", who.session);
  return req;
}

async function seedTor(title: string) {
  const field = (value: string | number) => ({ raw: String(value), value, confidence: 1, verified: true });
  const result = await tors(db).insertOne({
    contentHash: `access-${title}`, storage: { bucket: "test", key: "tor", contentType: "application/pdf", bytes: 1 }, sourceRefs: [],
    pipeline: { state: "published", attempts: 1 },
    fields: { title: field(title), agency: field("หน่วยงานทดสอบ"), budget: field(1000), deadline: field("2027-01-01"), torStatus: field("announced") },
    announcedAt: new Date(), sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date(),
  } as never);
  return result.insertedId.toString();
}

let a: Vendor;
let b: Vendor;
let torId: string;
let vaultId: string;
const A_PROJECT = "ผลงานลับของผู้ขายเอ-A-PROJECT";
const A_BYTES = Buffer.from("%PDF-1.4 A-SECRET-BYTES");
const A_FILE = "เอกสารลับของเอ-A-FILE.pdf";
/** Anything that identifies A: no response to B may contain one. */
let markers: string[];

const apiRoutes = matrixRows();
const mounts: Array<{ prefix: string; router: never }> = [];

beforeAll(async () => {
  // buildApp is the only place routers are mounted; recording its mounts gives the real route list, not a copy of it.
  const use = vi.spyOn(express.application, "use");
  const get = vi.spyOn(express.application, "get");
  db = await connect(isolatedDbUrl(config.mongoUrl, "access-control"));
  await ensureIndexes(db);
  app = buildApp(config, db);
  for (const [first, second] of use.mock.calls as unknown[][]) if (typeof first === "string" && second && typeof second === "function" && "stack" in second) mounts.push({ prefix: first, router: second as never });
  for (const [first, second] of get.mock.calls as unknown[][]) if (typeof first === "string" && typeof second === "function" && !("stack" in second)) mounts.push({ prefix: "", router: { stack: [{ route: { path: first, methods: { get: true } } }] } as never });
  mounted = mountedRoutes(mounts);
  use.mockRestore(); get.mockRestore();

  sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs);
  await Promise.all([accounts, sessions, bookmarks, vendorProfiles, vaultDocuments, behaviourEvents, tors].map((collection) => (collection(db) as { deleteMany(filter: object): Promise<unknown> }).deleteMany({})));
  a = await vendor("vendor-a@example.test", "ผู้ขายเอ-A-NAME");
  b = await vendor("vendor-b@example.test", "ผู้ขายบี-B-NAME");
  torId = await seedTor("โครงการของเอ-A-TOR");

  // Everything A can own: a profile with past work, a bookmark, a kept file, and recorded behaviour.
  expect((await as(a, "PUT", `${API_PREFIX}/me/profile`).send({ categories: [WORK_CATEGORIES[0]!.id], areas: ["thailand"], budget: null })).status).toBe(200);
  expect((await as(a, "PUT", `${API_PREFIX}/me/profile/extras`).send({ pastProjects: [{ title: A_PROJECT, year: 2567, valueThb: 123456 }] })).status).toBe(200);
  expect((await as(a, "PUT", `${API_PREFIX}/me/bookmarks/${torId}`).send({})).status).toBe(200);
  expect((await as(a, "POST", `${API_PREFIX}/me/consent/behaviour`).send({})).status).toBe(200);
  expect((await as(a, "POST", `${API_PREFIX}/me/events`).send({ torId, type: "view" })).status).toBe(204);
  const row = new ObjectId();
  vaultId = row.toString();
  // A real object in a real bucket, so a broken owner filter would hand B bytes, not just a row.
  const client = new GcsClient({ apiEndpoint: config.gcs.apiEndpoint, projectId: "emulator" });
  if (!(await client.bucket(config.gcs.vaultBucket).exists())[0]) await client.createBucket(config.gcs.vaultBucket);
  const key = `vault/${a.accountId}/${row}`;
  await new GcsVaultStorage({ bucket: config.gcs.vaultBucket, apiEndpoint: config.gcs.apiEndpoint, projectId: "emulator", timeoutMs: config.gcs.timeoutApiMs }).putIfAbsent(key, A_BYTES, "application/pdf");
  await vaultDocuments(db).insertOne({ _id: row, accountId: a.accountId, slot: 0, key, status: "ready", uploadedAt: new Date(), kind: "cv", filename: A_FILE, contentType: "application/pdf", bytes: A_BYTES.byteLength, sha256: "0".repeat(64) });
  markers = [a.accountId, a.email, a.displayName, A_PROJECT, A_FILE, vaultId, a.session];
});
afterAll(async () => { await disconnect(); });

describe("access matrix is the list of routes (T08, ASVS V8.1.1)", () => {
  it("every route the app mounts has a matrix row, and every row is a mounted route", () => {
    const documented = new Set(apiRoutes.map((row) => `${row.method} ${row.path}`));
    expect([...mounted].filter((route) => !documented.has(route)).sort()).toEqual([]);
    expect([...documented].filter((route) => !mounted.has(route)).sort()).toEqual([]);
  });

  it("covers the /me routes explicitly, so one cannot be added without a decision", () => {
    expect(apiRoutes.filter((row) => row.path.startsWith(`${API_PREFIX}/me`) && row.caller !== "vendor")).toEqual([]);
    expect(apiRoutes.filter((row) => row.caller === "vendor").length).toBeGreaterThanOrEqual(20);
  });
});

describe("no session: every vendor route answers 401", () => {
  for (const row of apiRoutes.filter((r) => r.caller === "vendor")) {
    it(`${row.method} ${row.path}`, async () => {
      const res = await as(null, row.method, concrete(row.path)).send({});
      expect(res.status).toBe(401);
    });
  }

  it("a made-up or expired session id is no session at all", async () => {
    expect((await request(app).get(`${API_PREFIX}/me`).set("x-session-id", "not-a-session")).status).toBe(401);
  });

  it("the optional match filter on public search needs identity too", async () => {
    expect((await request(app).get(`${API_PREFIX}/tors?minMatch=50`)).status).toBe(401);
  });
});

describe("a vendor session is not staff: every admin and intake route refuses it", () => {
  for (const row of apiRoutes.filter((r) => r.caller === "admin-key" || r.caller === "intake-key")) {
    it(`${row.method} ${row.path}`, async () => {
      const res = await as(b, row.method, concrete(row.path)).send(row.method === "HEAD" ? undefined : {});
      expect([401, 403]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(a.email);
      // a wrong key is as good as none
      const wrong = await as(b, row.method, concrete(row.path)).set("x-api-key", "wrong-key").send(row.method === "HEAD" ? undefined : {});
      expect([401, 403]).toContain(wrong.status);
    });
  }
});

describe("vendor B cannot read or change vendor A's data", () => {
  const mine = apiRoutes.filter((r) => r.caller === "vendor" && r.method === "GET" && !r.path.includes(":"));

  for (const row of mine) {
    it(`GET ${row.path} as B returns none of A's data`, async () => {
      const res = await as(b, "GET", concrete(row.path) + (row.path.endsWith("/me/path") ? `?target=${WORK_CATEGORIES[0]!.id}` : ""));
      const text = res.text;
      expect([200, 404]).toContain(res.status);
      for (const marker of markers) expect(text).not.toContain(marker);
    });
  }

  it("the /me/* GET routes are all in the loop above (nothing skipped by a path parameter)", () => {
    expect(mine.map((r) => r.path)).toEqual(expect.arrayContaining([`${API_PREFIX}/me`, `${API_PREFIX}/me/profile`, `${API_PREFIX}/me/bookmarks`, `${API_PREFIX}/me/vault`, `${API_PREFIX}/me/export`, `${API_PREFIX}/me/matches`, `${API_PREFIX}/me/matches/scores`]));
  });

  it("B's own views are empty while A's are not (the check above is not vacuous)", async () => {
    const mineA = await as(a, "GET", `${API_PREFIX}/me/export`);
    expect(mineA.body.profile.pastProjects[0].title).toBe(A_PROJECT);
    expect(mineA.body.bookmarks).toHaveLength(1);
    expect(mineA.body.behaviourEvents).toHaveLength(1);
    expect(mineA.body.vaultDocuments).toHaveLength(1);
    const theirs = await as(b, "GET", `${API_PREFIX}/me/export`);
    expect(theirs.body.account.email).toBe(b.email);
    expect(theirs.body).toMatchObject({ profile: null, bookmarks: [], behaviourEvents: [], vaultDocuments: [] });
    expect((await as(b, "GET", `${API_PREFIX}/me/profile`)).body.pastProjects).toEqual([]);
    expect((await as(b, "GET", `${API_PREFIX}/me/bookmarks`)).body).toEqual([]);
    expect((await as(b, "GET", `${API_PREFIX}/me/vault`)).body.documents).toEqual([]);
    expect((await as(b, "GET", `${API_PREFIX}/me/matches`)).body.items).toEqual([]);
    expect((await as(b, "GET", `${API_PREFIX}/tors?minMatch=0`)).body.items ?? []).toEqual([]);
  });

  it("B asking for A's vault file by id gets 404, the same as an id that does not exist", async () => {
    // positive control: the owner does get the bytes, so the 404 below is the filter and not a missing object
    const own = await as(a, "GET", `${API_PREFIX}/me/vault/${vaultId}/file`).buffer(true).parse((res, done) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => done(null, Buffer.concat(chunks))); });
    expect(own.status).toBe(200);
    expect(Buffer.from(own.body).equals(A_BYTES)).toBe(true);
    const theirs = await as(b, "GET", `${API_PREFIX}/me/vault/${vaultId}/file`);
    const missing = await as(b, "GET", `${API_PREFIX}/me/vault/${new ObjectId()}/file`);
    expect(theirs.status).toBe(404);
    expect(theirs.status).toBe(missing.status);
    expect(theirs.text).not.toContain(A_FILE);
    expect(theirs.text).not.toContain("A-SECRET-BYTES");
  });

  it("B deleting A's vault file gets 404 and the file is still there", async () => {
    expect((await as(b, "DELETE", `${API_PREFIX}/me/vault/${vaultId}`)).status).toBe(404);
    expect(await vaultDocuments(db).countDocuments({ _id: new ObjectId(vaultId), accountId: a.accountId, status: "ready" })).toBe(1);
  });

  it("B removing A's bookmark by TOR id leaves A's bookmark, and B saving the same TOR makes B's own", async () => {
    await as(b, "DELETE", `${API_PREFIX}/me/bookmarks/${torId}`);
    expect(await bookmarks(db).countDocuments({ accountId: a.accountId, torId })).toBe(1);
    expect((await as(b, "PUT", `${API_PREFIX}/me/bookmarks/${torId}`).send({})).status).toBe(200);
    expect(await bookmarks(db).countDocuments({ torId })).toBe(2);
    const ids = await as(b, "GET", `${API_PREFIX}/me/bookmarks/ids?torId=${torId}`);
    expect(ids.body).toEqual({ ids: [torId] });
    await as(b, "DELETE", `${API_PREFIX}/me/bookmarks/${torId}`);
    expect(await bookmarks(db).countDocuments({ accountId: a.accountId, torId })).toBe(1);
  });

  it("B's writes land on B's account only: profile, events, consent", async () => {
    expect((await as(b, "PUT", `${API_PREFIX}/me/profile/extras`).send({ pastProjects: [{ title: "ผลงานของบี", year: 2567, valueThb: 1 }] })).status).toBe(200);
    // B has not consented, so nothing is recorded however A's consent stands
    expect((await as(b, "POST", `${API_PREFIX}/me/events`).send({ torId, type: "view" })).status).toBe(403);
    expect((await as(a, "GET", `${API_PREFIX}/me/profile`)).body.pastProjects.map((p: { title: string }) => p.title)).toEqual([A_PROJECT]);
    expect(await behaviourEvents(db).countDocuments({ accountId: a.accountId })).toBe(1);
    expect(await behaviourEvents(db).countDocuments({ accountId: b.accountId })).toBe(0);
  });

  it("a draft request is bound to the caller's own data and never names another account", async () => {
    const res = await as(b, "POST", `${API_PREFIX}/me/tors/${torId}/draft`).send({});
    for (const marker of markers) expect(res.text).not.toContain(marker);
  });

  it("the /auth mount of the same routers shows B only B", async () => {
    const res = await as(b, "GET", "/auth/me/export");
    expect(res.status).toBe(200);
    expect(res.body.account.email).toBe(b.email);
    expect(res.text).not.toContain(a.email);
  });

  it("B deleting B's account does not touch A's data", async () => {
    expect((await as(b, "DELETE", `${API_PREFIX}/me`).send({ currentPassword: "correct-password" })).status).toBe(200);
    expect((await as(b, "GET", `${API_PREFIX}/me`)).status).toBe(401);
    const left = await as(a, "GET", `${API_PREFIX}/me/export`);
    expect(left.status).toBe(200);
    expect(left.body).toMatchObject({ bookmarks: [expect.anything()], behaviourEvents: [expect.anything()], vaultDocuments: [expect.anything()] });
    expect(left.body.profile.pastProjects[0].title).toBe(A_PROJECT);
  });
});
