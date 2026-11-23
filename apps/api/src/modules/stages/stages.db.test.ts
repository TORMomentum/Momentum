import "../../test/env.js";

import { ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../../core/config.js";
import { connect, disconnect, ensureIndexes, torEvents, tors, type TorDocument } from "../../core/db.js";
import type { ProjectStagesSource, SourceStage } from "../../ports/project-stages.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { StagesRepository } from "./stages.repository.js";
import { FAILURES_BEFORE_BACKOFF, StagesService } from "./stages.service.js";

const base = loadConfig(process.env);
const config: Config = { ...base, stages: { ...base.stages, requestDelayMs: 0, batch: 50 } };
const NOW = new Date("2026-11-23T03:00:00Z");
let db: Db;
let seq = 0;

const DRAFT: SourceStage = { code: "B0", description: "ร่างเอกสารประกวดราคา(e-Bidding)", on: "2026-10-21" };
const PRICE: SourceStage = { code: "BOQ", description: null, on: "2026-10-21" };
const INVITATION: SourceStage = { code: "D0", description: "ประกาศเชิญชวน", on: "2026-10-30" };

/** A source that answers from a table, records what it was asked, and can be told to refuse. */
function fakeSource(table: Record<string, SourceStage[]>, refuse = false) {
  const asked: string[] = [];
  const source: ProjectStagesSource = {
    system: "national-egp",
    async stagesOf(projectId) {
      asked.push(projectId);
      if (refuse) throw new Error("Source responded with status 429");
      return table[projectId] ?? [];
    },
  };
  return { source, asked };
}

async function seed(projectId: string, extra: Partial<TorDocument> = {}): Promise<string> {
  seq += 1;
  const doc: TorDocument = {
    contentHash: `stages-${seq}`,
    storage: { bucket: "raw", key: `k${seq}`, contentType: "application/pdf", bytes: 1 },
    sourceRefs: [],
    pipeline: { state: "published", attempts: 1 },
    fields: {},
    announcedAt: new Date("2026-10-21T00:00:00Z"),
    sourceProject: { system: "national-egp", projectId, projectNumber: projectId },
    sourceUrl: null,
    unverified: false,
    statusHistory: [],
    access: { restricted: false },
    duplicateOf: null,
    createdAt: new Date(NOW.getTime() - 86_400_000 + seq),
    updatedAt: NOW,
    ...extra,
  };
  return (await tors(db).insertOne(doc)).insertedId.toString();
}

function service(source: ProjectStagesSource) {
  return new StagesService({ repo: new StagesRepository(db), source, config, now: () => NOW, pause: async () => {} });
}

const read = (id: string) => tors(db).findOne({ _id: new ObjectId(id) });

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "stages"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  await Promise.all([tors(db).deleteMany({}), torEvents(db).deleteMany({})]);
});

afterAll(async () => {
  await disconnect();
});

describe("stages worker pass (TOR-205)", () => {
  it("writes the project's stages onto every public TOR record of it, and none onto its invitation", async () => {
    const tor = await seed("69109234234");
    const revised = await seed("69109234234");
    const invitation = await seed("69109234234", { documentType: "invitation" });
    const duplicate = await seed("69109234234", { duplicateOf: tor });
    const { source, asked } = fakeSource({ "69109234234": [DRAFT, PRICE, INVITATION] });

    expect(await service(source).seed()).toBe(2);
    const pass = await service(source).runPass();

    expect(pass).toEqual({ projects: 1, failed: 0, backOff: false });
    expect(asked).toEqual(["69109234234"]); // one request for the project, not one per record
    for (const id of [tor, revised]) {
      const record = await read(id);
      expect(record?.stage).toEqual({ code: "D0", kind: "invitation", on: "2026-10-30" });
      expect(record?.stageHistory?.map((row) => [row.code, row.recordId ?? null])).toEqual([
        ["B0", tor],
        ["BOQ", null],
        ["D0", invitation],
      ]);
      expect(record?.stagesCheckedAt).toEqual(NOW);
      expect(record?.stagesDueAt).toEqual(new Date(NOW.getTime() + config.stages.refreshMs));
    }
    for (const id of [invitation, duplicate]) expect((await read(id))?.stageHistory).toBeUndefined();
  });

  it("writes one audit entry when the stage moves, and none when it has not", async () => {
    const tor = await seed("69109000001");
    const table: Record<string, SourceStage[]> = { "69109000001": [DRAFT] };
    const { source } = fakeSource(table);
    await service(source).seed();
    await service(source).runPass();

    // Due again, nothing changed.
    await tors(db).updateMany({}, { $set: { stagesDueAt: NOW } });
    await service(source).runPass();
    // Due again, the invitation is out.
    table["69109000001"] = [DRAFT, INVITATION];
    await tors(db).updateMany({}, { $set: { stagesDueAt: NOW } });
    await service(source).runPass();

    const events = await torEvents(db).find({ torId: tor }, { sort: { _id: 1 } }).toArray();
    expect(events.map(({ kind, from, to, source: from_, actor }) => ({ kind, from, to, source: from_, actor }))).toEqual([
      { kind: "stage", from: null, to: "B0", source: "national-egp", actor: "stages-worker" },
      { kind: "stage", from: "B0", to: "D0", source: "national-egp", actor: "stages-worker" },
    ]);
  });

  it("stops following a project too old to follow, and leaves records of other systems alone", async () => {
    const old = await seed("69029000002", { announcedAt: new Date("2026-03-01T00:00:00Z") });
    const bma = await seed("bma-uuid", { sourceProject: { system: "bma-egp", projectId: "bma-uuid" } });
    const { source, asked } = fakeSource({ "69029000002": [{ code: "D0", description: null, on: "2026-03-10" }] });
    await service(source).seed();
    await service(source).runPass();

    expect((await read(old))?.stagesDueAt).toBeNull();
    expect((await read(bma))?.stagesDueAt).toBeUndefined();
    expect(asked).toEqual(["69029000002"]);
  });

  it("backs off after failed lookups in a row, and holds each failed record for the claim time", async () => {
    for (let i = 0; i < FAILURES_BEFORE_BACKOFF + 2; i += 1) await seed(`6910900010${i}`);
    const { source, asked } = fakeSource({}, true);
    await service(source).seed();
    const pass = await service(source).runPass();

    expect(pass).toEqual({ projects: FAILURES_BEFORE_BACKOFF, failed: FAILURES_BEFORE_BACKOFF, backOff: true });
    expect(asked).toHaveLength(FAILURES_BEFORE_BACKOFF);
    const held = await tors(db).countDocuments({ stagesDueAt: new Date(NOW.getTime() + config.stages.claimMs) });
    expect(held).toBe(FAILURES_BEFORE_BACKOFF);
    expect(await tors(db).countDocuments({ stagesCheckedAt: { $exists: true } })).toBe(0);
  });

  it("never claims a record another pass is holding", async () => {
    await seed("69109000003");
    const repo = new StagesRepository(db);
    await service(fakeSource({}).source).seed();
    const hold = new Date(NOW.getTime() + config.stages.claimMs);
    expect(await repo.claimNext("national-egp", NOW, hold)).not.toBeNull();
    expect(await repo.claimNext("national-egp", NOW, hold)).toBeNull();
  });
});
