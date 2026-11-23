import "../test/env.js";

import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../core/config.js";
import { connect, disconnect, tors } from "../core/db.js";
import { isolatedDbUrl } from "../test/mongo.js";
import type { StageKind } from "@tor-radar/shared";
import { TOR_STATES, openFilter, stateFilter, torStateOf, type TorState } from "./tor-state.js";

const config = loadConfig(process.env);
const TODAY = "2026-10-06";
let db: Db;

/** One record per interesting combination of status, deadline and the project's stage. */
const CASES: Array<{ torStatus: string | null; deadline: string | null; stageKind?: StageKind }> = [
  { torStatus: "announced", deadline: "2026-12-01" },
  { torStatus: "announced", deadline: TODAY },
  { torStatus: "announced", deadline: "2026-10-05" },
  { torStatus: "announced", deadline: null },
  { torStatus: "closed", deadline: "2026-12-01" },
  { torStatus: "closed", deadline: null },
  { torStatus: "awarded", deadline: "2026-12-01" },
  { torStatus: "cancelled", deadline: null },
  { torStatus: null, deadline: "2026-12-01" },
  // TOR-205: a final stage outranks what extraction read; any other stage changes nothing.
  { torStatus: "announced", deadline: "2026-12-01", stageKind: "awarded" },
  { torStatus: "announced", deadline: null, stageKind: "cancelled" },
  { torStatus: "awarded", deadline: null, stageKind: "cancelled" },
  { torStatus: "cancelled", deadline: null, stageKind: "awarded" },
  { torStatus: "announced", deadline: "2026-12-01", stageKind: "invitation" },
  { torStatus: "announced", deadline: null, stageKind: "draft" },
  { torStatus: "awarded", deadline: null, stageKind: "other" },
];

const key = (record: { torStatus: string | null; deadline: string | null; stageKind?: string | null }) =>
  `${record.torStatus}|${record.deadline}|${record.stageKind ?? null}`;

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "tor-state-db"));
  await tors(db).deleteMany({});
  await tors(db).insertMany(CASES.map((whatever, index) => ({
    contentHash: `state-${index}`,
    storage: { bucket: "raw", key: "x", contentType: "application/pdf", bytes: 1 },
    sourceRefs: [], pipeline: { state: "published", attempts: 1 },
    fields: {
      torStatus: { raw: String(whatever.torStatus), value: whatever.torStatus, confidence: 1, verified: true },
      deadline: { raw: String(whatever.deadline), value: whatever.deadline, confidence: 1, verified: true },
    },
    ...(whatever.stageKind ? { stage: { code: "X", kind: whatever.stageKind, on: "2026-10-01" } } : {}),
    announcedAt: null, sourceUrl: null, unverified: false, statusHistory: [],
    access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date(),
  })) as never);
});

afterAll(async () => { await disconnect(); });

describe("stateFilter agrees with torStateOf", () => {
  // The guard against the two definitions drifting apart: a TOR the dashboard
  // calls open and the list leaves out would be invisible to the vendor it
  // belongs to.
  it.each(TOR_STATES as TorState[])("selects exactly the records classified as %s", async (state) => {
    const expected = CASES
      .filter((record) => torStateOf({ torStatus: record.torStatus as never, deadline: record.deadline, stageKind: record.stageKind }, TODAY) === state)
      .map(key)
      .sort();

    const found = await tors(db).find(stateFilter(state, TODAY) as never).toArray();
    expect(found.map(asCase).sort()).toEqual(expected);
  });

  it("openFilter selects exactly the open and awaiting-invitation records", async () => {
    const expected = CASES
      .filter((record) => ["open", "awaiting-invitation"].includes(torStateOf({ torStatus: record.torStatus as never, deadline: record.deadline, stageKind: record.stageKind }, TODAY)))
      .map(key)
      .sort();
    const found = await tors(db).find(openFilter(TODAY) as never).toArray();
    expect(found.map(asCase).sort()).toEqual(expected);
  });
});

function asCase(doc: { fields: { torStatus?: { value: unknown }; deadline?: { value: unknown } }; stage?: { kind: string } }): string {
  return key({
    torStatus: (doc.fields.torStatus?.value as string | null) ?? null,
    deadline: (doc.fields.deadline?.value as string | null) ?? null,
    stageKind: doc.stage?.kind ?? null,
  });
}
