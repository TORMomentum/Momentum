import "../../test/env.js";

import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { connect, disconnect, ensureIndexes, tors, type TorDocument } from "../../core/db.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { CollectorRepository } from "./collector.repository.js";
import { COLLECTOR_SUBMITTER } from "./collector.service.js";

const config = loadConfig(process.env);
const NOW = new Date("2026-11-25T03:00:00Z");
const HOUR = 3_600_000;
let db: Db;
let repo: CollectorRepository;
let seq = 0;

async function seed(projectId: string, extra: Partial<TorDocument> = {}, submittedBy = "national-egp-import"): Promise<void> {
  seq += 1;
  const doc: TorDocument = {
    contentHash: `collector-${seq}`,
    storage: { bucket: "raw", key: `k${seq}`, contentType: "application/pdf", bytes: 1 },
    sourceRefs: [{ route: "url", submittedBy, submittedAt: NOW }],
    pipeline: { state: "published", attempts: 1 },
    fields: {},
    announcedAt: null,
    sourceProject: { system: "national-egp", projectId, projectNumber: projectId },
    sourceUrl: null,
    unverified: false,
    statusHistory: [],
    access: { restricted: false },
    duplicateOf: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
  await tors(db).insertOne(doc);
}

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "collector"));
  await ensureIndexes(db);
  repo = new CollectorRepository(db);
});

beforeEach(async () => {
  await tors(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("CollectorRepository (spec 2026-11-25-scheduled-collector)", () => {
  it("knows which document of a project it holds: the TOR, the invitation, or neither", async () => {
    await seed("69110000001", { documentType: "tor" });
    await seed("69110000002", { documentType: "invitation" });

    expect(await repo.holds("69110000001", "tor")).toBe(true);
    expect(await repo.holds("69110000001", "invitation")).toBe(false);
    expect(await repo.holds("69110000002", "tor")).toBe(false);
    expect(await repo.holds("69110000002", "invitation")).toBe(true);
    expect(await repo.holds("69110000003", "tor")).toBe(false);
  });

  it("counts only records the collector first created in the window, not ones it was linked onto later", async () => {
    await seed("69110000001", {}, COLLECTOR_SUBMITTER);
    await seed("69110000002", { createdAt: new Date(NOW.getTime() - 30 * HOUR) }, COLLECTOR_SUBMITTER);
    // Imported by hand first, then found again by the collector: a later reference costs nothing.
    await seed("69110000003", {
      sourceRefs: [
        { route: "url", submittedBy: "national-egp-import", submittedAt: NOW },
        { route: "url", submittedBy: COLLECTOR_SUBMITTER, submittedAt: NOW },
      ],
    });

    expect(await repo.createdSince(COLLECTOR_SUBMITTER, new Date(NOW.getTime() - 24 * HOUR))).toBe(1);
  });

  it("names the other source system that already collected an e-GP number", async () => {
    await seed("69110000001", { sourceProject: { system: "bma-egp", projectId: "b1", projectNumber: "69110000001" } });

    expect(await repo.collectedElsewhere("69110000001")).toBe("bma-egp");
    expect(await repo.collectedElsewhere("69110000002")).toBeNull();
  });

  it("lists awarded projects without an announcement, newest first, up to the limit", async () => {
    const awarded = (on: string) => ({ stageHistory: [{ code: "W0", kind: "awarded" as const, description: null, on }] });
    await seed("69110000001", { documentType: "tor", ...awarded("2026-11-10") });
    await seed("69110000002", { documentType: "tor", ...awarded("2026-11-20") });
    await seed("69110000003", { documentType: "tor", ...awarded("2026-11-15") });
    await seed("69110000003", { documentType: "award" });
    await seed("69110000004", { documentType: "tor" });

    expect(await repo.awardTargets(5)).toEqual([
      { projectId: "69110000002", announcedOn: "2026-11-20" },
      { projectId: "69110000001", announcedOn: "2026-11-10" },
    ]);
    expect(await repo.awardTargets(1)).toHaveLength(1);
    expect(await repo.awardTargets(0)).toEqual([]);
  });
});
