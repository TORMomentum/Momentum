import "../../test/env.js";

import { type Db, type Document } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExtractedField } from "@tor-radar/shared";
import { loadConfig } from "../../core/config.js";
import { connect, disconnect, ensureIndexes, tors, type TorDocument } from "../../core/db.js";
import { parseSearchQuery } from "./tors.query.js";
import { TorsRepository } from "./tors.repository.js";
import { TorsService } from "./tors.service.js";
import { isolatedDbUrl } from "../../test/mongo.js";

/**
 * NFR-F2: a search or filter returns within two seconds on the seeded corpus.
 *
 * The seeded demo corpus is fifteen records, against which any query is
 * instant, so this proves the target on a corpus several hundred times larger
 * instead — and checks that the indexed filters are served by an index, which
 * is what keeps the answer true as the corpus grows (TOR-43).
 */

const config = loadConfig(process.env);
const CORPUS_SIZE = 5_000;
const NFR_F2_MS = 2_000;

const AGENCIES = Array.from({ length: 50 }, (_, i) => `สำนักงานเขตทดสอบ ${i + 1}`);
const CATEGORIES = ["งานก่อสร้าง-ทาง", "งานก่อสร้าง-ชลประทาน", "งานก่อสร้าง-อาคาร", "จ้างเหมาบริการ", "ซื้อครุภัณฑ์", "จ้างที่ปรึกษา"];
const STATUSES = ["announced", "closed", "awarded", "cancelled"] as const;

let db: Db;
let service: TorsService;

function field<T>(value: T | null, verified = true): ExtractedField<T> {
  return { raw: value === null ? "" : String(value), value, confidence: 0.9, verified };
}

function syntheticRecord(i: number): TorDocument {
  const at = new Date(Date.UTC(2025, 0, 1) + (i % 600) * 86_400_000);
  const deadline = new Date(at.getTime() + 21 * 86_400_000).toISOString().slice(0, 10);
  const category = CATEGORIES[i % CATEGORIES.length];
  return {
    contentHash: `timing-${i}`,
    storage: { bucket: "tor-raw", key: `tors/timing/${i}.pdf`, contentType: "application/pdf", bytes: 10 },
    sourceRefs: [{ route: "api", submittedBy: "timing", submittedAt: at }],
    pipeline: { state: i % 20 === 0 ? "queued" : "published", attempts: 1 },
    fields: {
      title: field(`จ้าง${category}โครงการที่ ${i} ปรับปรุงถนนและระบบระบายน้ำ`),
      agency: field(AGENCIES[i % AGENCIES.length]),
      category: field(category),
      budget: field(i % 11 === 0 ? null : 100_000 + ((i * 7919) % 20_000_000)),
      deadline: field(i % 13 === 0 ? null : deadline),
      torStatus: field(STATUSES[i % STATUSES.length]),
    },
    announcedAt: i % 17 === 0 ? null : at,
    sourceUrl: null,
    confidenceLevel: i % 3 === 0 ? "medium" : "high",
    unverified: i % 3 === 0,
    statusHistory: [],
    access: { restricted: i % 97 === 0 },
    duplicateOf: null,
    createdAt: at,
    updatedAt: at,
  };
}

/** The winning plan's stage names, however deeply the planner nested them. */
function stages(plan: Document): string[] {
  const names: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.stage === "string") names.push(record.stage);
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(plan);
  return names;
}

const QUERIES: Array<[string, Record<string, string | string[]>]> = [
  ["the unfiltered first page", {}],
  ["one agency", { agency: AGENCIES[7] }],
  ["several agencies", { agency: [AGENCIES[1], AGENCIES[2], AGENCIES[3]] }],
  ["a category", { category: CATEGORIES[2] }],
  ["a budget range", { minBudget: "1000000", maxBudget: "5000000" }],
  ["a deadline range", { deadlineFrom: "2025-06-01", deadlineTo: "2025-06-30" }],
  ["open only", { open: "true" }],
  ["a Thai keyword", { q: "ระบายน้ำ" }],
  [
    "every filter at once",
    {
      agency: [AGENCIES[4], AGENCIES[10]],
      category: CATEGORIES[0],
      minBudget: "500000",
      maxBudget: "15000000",
      deadlineFrom: "2025-01-01",
      deadlineTo: "2026-12-31",
      from: "2025-01-01",
      to: "2026-12-31",
      q: "ถนน",
    },
  ],
];

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "search-timing"));
  await ensureIndexes(db);
  await tors(db).deleteMany({});
  const docs = Array.from({ length: CORPUS_SIZE }, (_, i) => syntheticRecord(i));
  await tors(db).insertMany(docs, { ordered: false });

  service = new TorsService({
    repo: new TorsRepository(db),
    config,
    now: () => new Date("2025-06-15T03:00:00Z"),
  });
}, 60_000);

afterAll(async () => {
  await db.dropDatabase();
  await disconnect();
});

describe(`NFR-F2 on a ${CORPUS_SIZE}-record corpus`, () => {
  it.each(QUERIES)("returns %s within two seconds", async (_label, query) => {
    const started = performance.now();
    const page = await service.search(parseSearchQuery(query, config.search));
    const elapsed = performance.now() - started;

    expect(page.items.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(NFR_F2_MS);
  });

  it("walks deep pages within two seconds each — the cursor does not degrade like skip", async () => {
    let cursor: string | null = null;
    let slowest = 0;
    for (let page = 0; page < 20; page += 1) {
      const query: Record<string, string> = { pageSize: "100", ...(cursor ? { cursor } : {}) };
      const started = performance.now();
      const result = await service.search(parseSearchQuery(query, config.search));
      slowest = Math.max(slowest, performance.now() - started);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    expect(slowest).toBeLessThan(NFR_F2_MS);
  });

  it("returns the facets within two seconds", async () => {
    const started = performance.now();
    const facets = await service.facets();
    expect(performance.now() - started).toBeLessThan(NFR_F2_MS);
    expect(facets.agencies.length).toBeGreaterThan(0);
  });
});

describe("TOR-43: the indexed filters are served by an index", () => {
  const visible = {
    "pipeline.state": "published",
    "access.restricted": { $ne: true },
    duplicateOf: null,
  };

  it.each([
    ["the unfiltered list, in cursor order", {}],
    ["an agency filter", { "fields.agency.value": { $in: [AGENCIES[7]] } }],
    ["a category filter", { "fields.category.value": { $in: [CATEGORIES[2]] } }],
  ])("plans %s without a collection scan", async (_label, filter) => {
    const explained = await tors(db)
      .find({ $and: [visible, filter] }, { sort: { announcedAt: -1, _id: -1 }, limit: 21 })
      .explain("queryPlanner");

    const winning = stages((explained.queryPlanner as Document).winningPlan as Document);
    expect(winning).not.toContain("COLLSCAN");
    expect(winning).toContain("IXSCAN");
  });
});
