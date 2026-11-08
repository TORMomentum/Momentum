import "../../test/env.js";

import { type Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { connect, disconnect, ensureIndexes, ensureSearchIndex, tors, type TorDocument } from "../../core/db.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { TorsRepository, type SearchCriteria } from "./tors.repository.js";

/** Needs Atlas Search: mongodb-atlas-local in Compose and CI, the Atlas cluster in deployment. */
const config = loadConfig({ ...process.env, SEARCH_ATLAS_ENABLED: "true" });
const { indexName } = config.search;

let db: Db;

function doc(title: string, agency: string): TorDocument {
  const field = (raw: string) => ({ raw, value: raw, confidence: 0.97, verified: true, evidence: "quote" });
  return {
    contentHash: `h-${title}`, createdAt: new Date(), announcedAt: new Date("2026-09-01T00:00:00Z"),
    confidenceLevel: "high", unverified: false, pipeline: { state: "published" },
    fields: { title: field(title), agency: field(agency) },
  } as unknown as TorDocument;
}

function criteria(q: string): SearchCriteria {
  return { q, agencies: [], categories: [] } as unknown as SearchCriteria;
}

async function queryable(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const [index] = (await tors(db).listSearchIndexes(indexName).toArray()) as { queryable?: boolean }[];
    if (index?.queryable) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("search index did not become queryable");
}

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "atlas_search"));
  await db.dropDatabase();
  await ensureIndexes(db);
  await tors(db).insertMany([
    doc("จ้างก่อสร้างถนนคอนกรีต", "สำนักงานเขตบางรัก"),
    doc("จัดซื้อครุภัณฑ์คอมพิวเตอร์", "กรมบัญชีกลาง"),
  ]);
  await ensureSearchIndex(db, indexName);
  await queryable();
}, 90_000);

afterAll(async () => {
  await db.dropDatabase();
  await disconnect();
});

describe("Atlas Search keyword match (lucene.thai)", () => {
  it("finds a Thai word inside a title with no spaces", async () => {
    const page = await new TorsRepository(db, config.search).search(criteria("ก่อสร้าง"), 10, null);
    expect(page.items.map((i) => i.title.raw)).toEqual(["จ้างก่อสร้างถนนคอนกรีต"]);
  });

  it("matches the agency as well as the title", async () => {
    const page = await new TorsRepository(db, config.search).search(criteria("กรมบัญชีกลาง"), 10, null);
    expect(page.items).toHaveLength(1);
  });

  it("returns nothing for a word in no record", async () => {
    const page = await new TorsRepository(db, config.search).search(criteria("เรือดำน้ำ"), 10, null);
    expect(page.items).toHaveLength(0);
  });

  it("calling ensureSearchIndex twice leaves one index", async () => {
    await ensureSearchIndex(db, indexName);
    expect(await tors(db).listSearchIndexes(indexName).toArray()).toHaveLength(1);
  });
});
