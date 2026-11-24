import "../../test/env.js";

import { ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AwardResult } from "@tor-radar/shared";
import { loadConfig } from "../../core/config.js";
import { connect, disconnect, ensureIndexes, tors, type TorDocument } from "../../core/db.js";
import { INDIVIDUAL_WINNER } from "../../lib/redact.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AWARD_STAGE_CODES } from "../../sources/national-egp/stages.js";
import { TorsRepository } from "../tors/tors.repository.js";
import { TorsService } from "../tors/tors.service.js";
import { ExtractionRepository } from "./extraction.repository.js";

const config = loadConfig(process.env);
const NOW = new Date("2026-11-24T03:00:00Z");
const PROJECT = "69099218130";
let db: Db;

async function record(extra: Partial<TorDocument> = {}): Promise<string> {
  const { insertedId } = await tors(db).insertOne({
    contentHash: new ObjectId().toHexString(),
    storage: { bucket: "raw", key: new ObjectId().toHexString(), contentType: "application/pdf", bytes: 1 },
    sourceRefs: [],
    pipeline: { state: "published", attempts: 1 },
    fields: {},
    announcedAt: null,
    sourceProject: { system: "national-egp", projectId: PROJECT },
    sourceUrl: null,
    unverified: false,
    statusHistory: [],
    access: { restricted: false },
    duplicateOf: null,
    createdAt: NOW,
    updatedAt: NOW,
    stageHistory: [
      { code: "D0", kind: "invitation", description: "ประกาศเชิญชวน", on: "2026-10-30" },
      { code: "W0", kind: "awarded", description: "ประกาศผู้ชนะ", on: "2026-11-20" },
    ],
    ...extra,
  } as TorDocument);
  return insertedId.toHexString();
}

const award = (recordId: string, name: string, winnerKind: "juristic" | "individual"): AwardResult => ({
  recordId,
  winner: { raw: name, value: name, confidence: 0.97 },
  winnerKind,
  price: { raw: "1,250,000.00", value: 1_250_000, confidence: 0.98 },
  announcedOn: "2026-11-20",
  unverified: false,
  provenance: { ocrModel: "m", extractModel: "m", modelVersion: "m-001", extractedAt: NOW.toISOString(), thresholdsVersion: "t" },
});

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "award"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  await tors(db).deleteMany({});
});

afterAll(async () => {
  await db.dropDatabase();
  await disconnect();
});

describe("linkAward (TOR-221)", () => {
  it("puts the award on the project's TORs and points their winner stage at it, not on supporting documents", async () => {
    const torId = await record();
    const invitationId = await record({ documentType: "invitation" });
    const awardId = await record({ documentType: "award", stageHistory: [] });
    const other = await record({ sourceProject: { system: "national-egp", projectId: "69099999999" } });

    const linked = await new ExtractionRepository(db).linkAward(PROJECT, award(awardId, "บริษัท ก จำกัด", "juristic"), AWARD_STAGE_CODES);

    expect(linked).toBe(1);
    const tor = await tors(db).findOne({ _id: new ObjectId(torId) });
    expect(tor?.award?.recordId).toBe(awardId);
    expect(tor?.stageHistory?.find((stage) => stage.code === "W0")?.recordId).toBe(awardId);
    expect(tor?.stageHistory?.find((stage) => stage.code === "D0")?.recordId).toBeUndefined();
    expect((await tors(db).findOne({ _id: new ObjectId(invitationId) }))?.award).toBeUndefined();
    expect((await tors(db).findOne({ _id: new ObjectId(awardId) }))?.award).toBeUndefined();
    expect((await tors(db).findOne({ _id: new ObjectId(other) }))?.award).toBeUndefined();
  });
});

describe("the public TOR detail's award (TOR-221)", () => {
  const service = () => new TorsService({ repo: new TorsRepository(db), config, now: () => NOW });

  it("names a juristic winner as extracted", async () => {
    const torId = await record({ award: award(new ObjectId().toHexString(), "บริษัท สยามก่อสร้าง จำกัด", "juristic") });
    const detail = await service().detail(torId);
    expect(detail.award?.winner.value).toBe("บริษัท สยามก่อสร้าง จำกัด");
    expect(detail.award?.price.value).toBe(1_250_000);
  });

  it("never sends a natural person's name", async () => {
    const torId = await record({ award: award(new ObjectId().toHexString(), "นายสมชาย ใจดี", "individual") });
    const detail = await service().detail(torId);
    expect(detail.award?.winner).toEqual({ raw: INDIVIDUAL_WINNER, value: INDIVIDUAL_WINNER, confidence: 0.97 });
    expect(JSON.stringify(detail)).not.toContain("สมชาย");
  });

  it("is null for a TOR with no award collected, and an award record is not itself a public TOR", async () => {
    const torId = await record();
    expect((await service().detail(torId)).award).toBeNull();
    const awardId = await record({ documentType: "award" });
    await expect(service().detail(awardId)).rejects.toThrow();
  });
});
