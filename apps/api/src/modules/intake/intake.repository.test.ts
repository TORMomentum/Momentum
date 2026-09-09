import "../../test/env.js";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { connect, disconnect, ensureIndexes, tors } from "../../core/db.js";
import { IntakeRepository } from "./intake.repository.js";
import { loadConfig } from "../../core/config.js";

const config = loadConfig(process.env);
let db: Db;
let repository: IntakeRepository;

const stored = { bucket: "tor-raw", key: "abc", contentType: "application/pdf", bytes: 10 };
const source = { route: "upload" as const, submittedBy: "admin", submittedAt: new Date() };

beforeAll(async () => {
  db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  repository = new IntakeRepository(db);
});

beforeEach(async () => {
  await tors(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("IntakeRepository", () => {
  it("inserts a queued record and finds it by hash", async () => {
    const id = await repository.insert("abc", stored, source);
    const found = await repository.findByHash("abc");
    expect(found?.id).toBe(id);
    expect(found?.pipeline.state).toBe("queued");
  });

  it("returns null for an unknown hash", async () => {
    expect(await repository.findByHash("missing")).toBeNull();
  });

  it("appends a source reference without duplicating the record", async () => {
    const id = await repository.insert("abc", stored, source);
    await repository.appendSourceRef(id, {
      route: "url",
      url: "https://example.org/a.pdf",
      submittedBy: "admin",
      submittedAt: new Date(),
    });

    const document = await tors(db).findOne({ contentHash: "abc" });
    expect(document?.sourceRefs).toHaveLength(2);
    expect(await tors(db).countDocuments()).toBe(1);
  });

  it("records the source URL when the submission had one", async () => {
    await repository.insert("abc", stored, {
      route: "url",
      url: "https://example.org/a.pdf",
      submittedBy: "admin",
      submittedAt: new Date(),
    });

    const document = await tors(db).findOne({ contentHash: "abc" });
    expect(document?.sourceUrl).toBe("https://example.org/a.pdf");
  });

  it("leaves announcedAt null, because it is the agency's date and is extracted later", async () => {
    await repository.insert("abc", stored, source);

    const document = await tors(db).findOne({ contentHash: "abc" });
    expect(document?.announcedAt).toBeNull();
    expect(document?.createdAt).toBeInstanceOf(Date);
  });

  it("opens the status history with the submitting route and actor", async () => {
    await repository.insert("abc", stored, source);

    const document = await tors(db).findOne({ contentHash: "abc" });
    expect(document?.statusHistory).toHaveLength(1);
    expect(document?.statusHistory[0]).toMatchObject({
      from: null,
      to: "queued",
      actor: "admin",
      source: "upload",
    });
  });

  it("rejects a second insert of the same hash", async () => {
    await repository.insert("abc", stored, source);
    await expect(repository.insert("abc", stored, source)).rejects.toMatchObject({ code: 11000 });
  });
});
