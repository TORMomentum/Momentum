import "../test/env.js";

import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../core/config.js";
import { connect, disconnect, tors } from "../core/db.js";
import { isolatedDbUrl } from "../test/mongo.js";
import { TOR_STATES, stateFilter, torStateOf, type TorState } from "./tor-state.js";

const config = loadConfig(process.env);
const TODAY = "2026-10-06";
let db: Db;

/** One record per interesting combination of status and deadline. */
const CASES: Array<{ torStatus: string | null; deadline: string | null }> = [
  { torStatus: "announced", deadline: "2026-12-01" },
  { torStatus: "announced", deadline: TODAY },
  { torStatus: "announced", deadline: "2026-10-05" },
  { torStatus: "announced", deadline: null },
  { torStatus: "closed", deadline: "2026-12-01" },
  { torStatus: "closed", deadline: null },
  { torStatus: "awarded", deadline: "2026-12-01" },
  { torStatus: "cancelled", deadline: null },
  { torStatus: null, deadline: "2026-12-01" },
];

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
      .filter((record) => torStateOf({ torStatus: record.torStatus as never, deadline: record.deadline }, TODAY) === state)
      .map((record) => `${record.torStatus}|${record.deadline}`)
      .sort();

    const found = await tors(db).find(stateFilter(state, TODAY) as never).toArray();
    const actual = found
      .map((doc) => `${doc.fields.torStatus?.value ?? null}|${doc.fields.deadline?.value ?? null}`)
      .sort();

    expect(actual).toEqual(expected);
  });
});
