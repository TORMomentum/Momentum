import "../../test/env.js";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { connect, disconnect, ensureIndexes, corrections, tors } from "../../core/db.js";
import { loadConfig } from "../../core/config.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AdminRepository } from "./admin.repository.js";

const config = loadConfig(process.env);
let db: Db;
let repository: AdminRepository;

/** A published record that graded low — the only thing the queue contains. */
async function seedQueued(over: Record<string, unknown> = {}): Promise<string> {
  const now = new Date();
  const result = await tors(db).insertOne({
    contentHash: `hash-${Math.random().toString(16).slice(2)}`,
    storage: { bucket: "tor-raw", key: "tors/2026/09/x.pdf", contentType: "application/pdf", bytes: 10 },
    sourceRefs: [{ route: "upload", submittedBy: "admin", submittedAt: now }],
    pipeline: { state: "published", attempts: 1 },
    fields: {
      title: { raw: "จ้างเหมาปรับปรุงอาคารเรียน", value: "จ้างเหมาปรับปรุงอาคารเรียน", confidence: 0.91, verified: false },
      agency: { raw: "สพฐ. เขตพื้นที่ 3", value: "สพฐ. เขตพื้นที่ 3", confidence: 0.88, verified: false },
      budget: { raw: "", value: null, confidence: 0.12, verified: false },
    },
    announcedAt: null,
    sourceUrl: null,
    confidenceLevel: "low",
    unverified: true,
    reviewReasons: ["budget-missing"],
    statusHistory: [],
    access: { restricted: false },
    duplicateOf: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as never);
  return result.insertedId.toString();
}

beforeAll(async () => {
  // Its own database: this suite empties `tors`, and the intake suite is
  // reading the same collection at the same time under file parallelism.
  db = await connect(isolatedDbUrl(config.mongoUrl, "admin"));
  await ensureIndexes(db);
  repository = new AdminRepository(db);
});

beforeEach(async () => {
  await tors(db).deleteMany({});
  await corrections(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("AdminRepository", () => {
  it("queues only published, low-confidence, unrestricted records", async () => {
    await seedQueued();
    await seedQueued({ confidenceLevel: "medium" });
    await seedQueued({ access: { restricted: true, reason: "takedown" } });
    await seedQueued({ pipeline: { state: "queued", attempts: 0 } });

    const queue = await repository.listQueue(50);
    expect(queue).toHaveLength(1);
    expect(queue[0].reviewReasons).toEqual(["budget-missing"]);
  });

  it("returns the oldest first, so a record cannot starve", async () => {
    const older = await seedQueued({ createdAt: new Date("2026-09-01T00:00:00Z") });
    await seedQueued({ createdAt: new Date("2026-09-09T00:00:00Z") });

    const queue = await repository.listQueue(50);
    expect(queue[0].id).toBe(older);
  });

  it("filters by reason, which is how the queue is triaged", async () => {
    await seedQueued({ reviewReasons: ["budget-missing"] });
    await seedQueued({ reviewReasons: ["deadline-before-announcement"] });

    const queue = await repository.listQueue(50, "deadline-before-announcement");
    expect(queue).toHaveLength(1);
    expect(queue[0].reviewReasons).toEqual(["deadline-before-announcement"]);
  });

  it("counts unverified records that never entered the queue", async () => {
    await seedQueued();
    await seedQueued({ confidenceLevel: "medium" });
    await seedQueued({ confidenceLevel: "medium" });

    expect(await repository.countUnverifiedNotQueued()).toBe(2);
  });

  it("records every edit as a correction before changing the record (FR-G-2)", async () => {
    const id = await seedQueued();

    await repository.applyEdits(id, [{ field: "budget", value: "1250000" }], "reviewer-1");

    const stored = await corrections(db).find({ torId: id }).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ field: "budget", actor: "reviewer-1" });
    expect((stored[0].before as { value: unknown }).value).toBeNull();
    expect((stored[0].after as { value: unknown }).value).toBe("1250000");
  });

  it("marks a corrected field verified — a human read the document", async () => {
    const id = await seedQueued();

    await repository.applyEdits(id, [{ field: "budget", value: "1250000" }], "reviewer-1");

    const record = await repository.load(id);
    expect(record.fields.budget).toMatchObject({ raw: "1250000", confidence: 1, verified: true });
  });

  it("approving clears the unverified mark but keeps the grade", async () => {
    const id = await seedQueued();

    await repository.approve(id);

    const doc = await tors(db).findOne({});
    // confidenceLevel stays "low": it records what the model produced, and
    // rewriting it would erase the fact that this record needed a human.
    expect(doc?.unverified).toBe(false);
    expect(doc?.confidenceLevel).toBe("low");
    expect(doc?.reviewReasons).toEqual([]);
    expect(await repository.listQueue(50)).toHaveLength(0);
  });

  it("rejecting restricts access and never touches the stored document", async () => {
    const id = await seedQueued();
    const before = await tors(db).findOne({});

    await repository.reject(id, "ไม่ใช่ TOR", "reviewer-1");

    const after = await tors(db).findOne({});
    expect(after?.access).toMatchObject({ restricted: true, reason: "ไม่ใช่ TOR" });
    expect(after?.storage).toEqual(before?.storage);
    expect(after?.contentHash).toBe(before?.contentHash);
  });
});
