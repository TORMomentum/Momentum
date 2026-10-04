import "../../test/env.js";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { STATUS_HISTORY_KEPT, connect, disconnect, ensureIndexes, torEvents, tors } from "../../core/db.js";
import { IntakeRepository } from "./intake.repository.js";
import { HistoryRepository } from "../history/history.repository.js";
import { loadConfig } from "../../core/config.js";

const config = loadConfig(process.env);
let db: Db;
let repository: IntakeRepository;
let history: HistoryRepository;

const stored = { bucket: "tor-raw", key: "abc", contentType: "application/pdf", bytes: 10 };
const source = { route: "upload" as const, submittedBy: "admin", submittedAt: new Date() };

beforeAll(async () => {
  db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  repository = new IntakeRepository(db);
  history = new HistoryRepository(db);
});

beforeEach(async () => {
  await tors(db).deleteMany({});
  await torEvents(db).deleteMany({});
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

  it("writes the first transition to the events collection as well", async () => {
    const torId = await repository.insert("abc", stored, source);

    const events = await torEvents(db).find({ torId }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from: null, to: "queued", actor: "admin", source: "upload" });
  });

  it("keeps every transition in the events collection but caps the copy on the record", async () => {
    // The write lives on HistoryRepository now: intake, the worker and an admin
    // all record a transition the same way, so the cap cannot be honoured in one
    // caller and forgotten in another.
    const torId = await repository.insert("abc", stored, source);

    // Well past the cap: a record corrected many times must not grow the
    // document, which is the whole point of the split.
    const transitions = STATUS_HISTORY_KEPT + 5;
    for (let i = 0; i < transitions; i++) {
      await history.record(torId, {
        from: "queued",
        to: "extracting",
        actor: "worker",
        source: "worker",
      });
    }

    const document = await tors(db).findOne({ contentHash: "abc" });
    expect(document?.statusHistory).toHaveLength(STATUS_HISTORY_KEPT);

    // The first insert wrote one event, and every transition wrote another.
    const events = await torEvents(db).countDocuments({ torId });
    expect(events).toBe(transitions + 1);
  });

  it("keeps a document's first source project when another system publishes the same file", async () => {
    const id = await repository.insert("abc", stored, source, undefined, {
      sourceProject: { system: "bma-egp", projectId: "ffe2ca8d-b909-4a3e-aa2f-1509051f5042", projectNumber: "69099198268" },
    });

    await repository.attachSourceContext(id, {
      documentType: "tor",
      sourceProject: { system: "national-egp", projectId: "69099198268", projectNumber: "69099198268" },
    });

    const document = await tors(db).findOne({ contentHash: "abc" });
    expect(document?.sourceProject?.system).toBe("bma-egp");
    expect(document?.documentType).toBe("tor");
  });

  it("lets a later visit from the same system, or the first one, link the project", async () => {
    const unlinked = await repository.insert("abc", stored, source);
    await repository.attachSourceContext(unlinked, { sourceProject: { system: "national-egp", projectId: "69099198268" } });
    await repository.attachSourceContext(unlinked, {
      sourceProject: { system: "national-egp", projectId: "69099198268", projectNumber: "69099198268" },
    });

    const document = await tors(db).findOne({ contentHash: "abc" });
    expect(document?.sourceProject).toEqual({ system: "national-egp", projectId: "69099198268", projectNumber: "69099198268" });
  });

  it("rejects a second insert of the same hash", async () => {
    await repository.insert("abc", stored, source);
    await expect(repository.insert("abc", stored, source)).rejects.toMatchObject({ code: 11000 });
  });
});
