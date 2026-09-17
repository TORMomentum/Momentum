import "../../test/env.js";

import express from "express";
import { type Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExtractedField, TorFields } from "@tor-radar/shared";
import { loadConfig } from "../../core/config.js";
import { connect, disconnect, ensureIndexes, tors, type TorDocument } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import type { Storage } from "../../ports/storage.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { parseSearchQuery } from "./tors.query.js";
import { TorsRepository } from "./tors.repository.js";
import { buildTorsRouter } from "./tors.routes.js";
import { TorsService } from "./tors.service.js";

const config = loadConfig(process.env);
/** A fixed "today" in Bangkok, so "open" does not drift with the calendar. */
const NOW = new Date("2026-09-16T03:00:00Z");

let db: Db;
let seq = 0;

function field<T>(value: T | null, verified = true, raw?: string): ExtractedField<T> {
  return { raw: raw ?? (value === null ? "" : String(value)), value, confidence: 0.97, verified, evidence: "quote" };
}

interface Seed {
  title?: string;
  agency?: string;
  category?: string;
  budget?: number | null;
  deadline?: string | null;
  status?: "announced" | "closed" | "awarded" | "cancelled";
  announcedAt?: string | null;
  state?: string;
  restricted?: boolean;
  duplicateOf?: string | null;
  confidenceLevel?: "high" | "medium" | "low";
  contact?: string;
  referenceNo?: string;
}

async function seed(overrides: Seed = {}): Promise<string> {
  seq += 1;
  const now = new Date(Date.UTC(2026, 8, 1, 0, seq));
  const fields: Partial<TorFields> = {
    title: field(overrides.title ?? `จ้างก่อสร้างถนนสายที่ ${seq}`),
    agency: field(overrides.agency ?? "สำนักงานเขตทวีวัฒนา"),
    category: field(overrides.category ?? "งานก่อสร้าง-ทาง"),
    budget: field(overrides.budget === undefined ? 1_000_000 : overrides.budget),
    deadline: field(overrides.deadline === undefined ? null : overrides.deadline),
    torStatus: field(overrides.status ?? "announced"),
    contact: field(overrides.contact ?? "ฝ่ายโยธา โทร 02 123 4567"),
    ...(overrides.referenceNo ? { referenceNo: field(overrides.referenceNo) } : {}),
  };
  const doc: TorDocument = {
    contentHash: `search-test-${seq}`,
    storage: { bucket: "tor-raw", key: `tors/2026/09/search-test-${seq}.pdf`, contentType: "application/pdf", bytes: 10 },
    sourceRefs: [{ route: "upload", submittedBy: "admin", submittedAt: now }],
    pipeline: { state: overrides.state ?? "published", attempts: 1 },
    fields,
    announcedAt:
      overrides.announcedAt === undefined
        ? new Date(Date.UTC(2026, 7, 1 + (seq % 28)))
        : overrides.announcedAt === null
          ? null
          : new Date(`${overrides.announcedAt}T00:00:00Z`),
    sourceUrl: "https://webportal.bangkok.go.th/tor.pdf",
    confidenceLevel: overrides.confidenceLevel ?? "high",
    unverified: (overrides.confidenceLevel ?? "high") !== "high",
    statusHistory: [],
    access: { restricted: overrides.restricted ?? false },
    duplicateOf: overrides.duplicateOf ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const result = await tors(db).insertOne(doc);
  return result.insertedId.toString();
}

function buildTestApp() {
  const app = express();
  app.use(
    "/api/v1/tors",
    buildTorsRouter({
      service: new TorsService({
        repo: new TorsRepository(db),
        storage: {} as Storage,
        signedUrlTtlSeconds: config.signedUrlTtlSeconds,
        facetLimit: config.search.facetLimit,
        timeZone: "Asia/Bangkok",
        now: () => NOW,
      }),
      search: config.search,
    }),
  );
  app.use(errorMiddleware);
  return app;
}

async function search(query: string) {
  const response = await request(buildTestApp()).get(`/api/v1/tors?${query}`);
  expect(response.status).toBe(200);
  return response.body as { items: Array<{ id: string; title: { raw: string } }>; total: number; nextCursor: string | null };
}

const ids = (body: { items: Array<{ id: string }> }) => body.items.map((item) => item.id).sort();

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "tors-search"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  await tors(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("GET /tors — what is listed", () => {
  it("lists published records of every confidence tier, and nothing withdrawn, unfinished or duplicated", async () => {
    const high = await seed({ confidenceLevel: "high" });
    const medium = await seed({ confidenceLevel: "medium" });
    const low = await seed({ confidenceLevel: "low" });
    await seed({ state: "queued" });
    await seed({ state: "failed" });
    await seed({ restricted: true });
    await seed({ duplicateOf: high });
    const invitation = await seed({ agency: "สำนักงานเขตเฉพาะประกาศเชิญชวน" });
    await tors(db).updateOne({ contentHash: `search-test-${seq}` }, { $set: { documentType: "invitation" } });

    const body = await search("");

    // An invitation to bid is a supporting document: never a row, an option, or a page of its own.
    const facets = await request(buildTestApp()).get("/api/v1/tors/facets");
    expect(JSON.stringify(facets.body)).not.toContain("สำนักงานเขตเฉพาะประกาศเชิญชวน");
    expect((await request(buildTestApp()).get(`/api/v1/tors/${invitation}`)).status).toBe(404);

    expect(ids(body)).toEqual([high, medium, low].sort());
    expect(body.total).toBe(3);
  });

  it("returns list fields only — no contact, evidence or storage", async () => {
    await seed();

    const response = await request(buildTestApp()).get("/api/v1/tors");
    const [item] = response.body.items;

    expect(item).not.toHaveProperty("contact");
    expect(item).not.toHaveProperty("storage");
    expect(JSON.stringify(response.body)).not.toContain("evidence");
    expect(JSON.stringify(response.body)).not.toContain("02 123 4567");
  });

  it("names each row by its project number, and leaves it empty when none is stated", async () => {
    const numbered = await seed({ referenceNo: "69079434637" });
    const unnumbered = await seed();

    const body = (await request(buildTestApp()).get("/api/v1/tors")).body as {
      items: Array<{ id: string; referenceNo: { raw: string; verified: boolean } }>;
    };
    const row = (id: string) => body.items.find((item) => item.id === id);

    expect(row(numbered)?.referenceNo).toEqual({ raw: "69079434637", verified: true });
    expect(row(unnumbered)?.referenceNo).toEqual({ raw: "", verified: false });
  });

  it("states when the corpus was last updated (FR-E-6)", async () => {
    await seed();
    const response = await request(buildTestApp()).get("/api/v1/tors");
    expect(response.body.coverage.lastUpdatedAt).toEqual(expect.any(String));
  });
});

describe("GET /tors — each filter", () => {
  it("filters by agency, with repeated values OR-ed", async () => {
    const a = await seed({ agency: "สำนักงานเขตจตุจักร" });
    const b = await seed({ agency: "สำนักการโยธา" });
    await seed({ agency: "สำนักงานเขตบางรัก" });

    const one = await search(`agency=${encodeURIComponent("สำนักงานเขตจตุจักร")}`);
    const two = await search(
      `agency=${encodeURIComponent("สำนักงานเขตจตุจักร")}&agency=${encodeURIComponent("สำนักการโยธา")}`,
    );

    expect(ids(one)).toEqual([a]);
    expect(ids(two)).toEqual([a, b].sort());
  });

  it("filters by category", async () => {
    const building = await seed({ category: "งานก่อสร้าง-อาคาร" });
    await seed({ category: "ซื้อครุภัณฑ์" });

    expect(ids(await search(`category=${encodeURIComponent("งานก่อสร้าง-อาคาร")}`))).toEqual([building]);
  });

  it("filters by budget range, inclusive, and a record without a budget cannot satisfy a bound", async () => {
    const low = await seed({ budget: 500_000 });
    const mid = await seed({ budget: 2_000_000 });
    await seed({ budget: 9_000_000 });
    await seed({ budget: null });

    expect(ids(await search("minBudget=500000&maxBudget=2000000"))).toEqual([low, mid].sort());
    expect(ids(await search("minBudget=2000000"))).toHaveLength(2);
  });

  it("filters by deadline range, inclusive of both ends", async () => {
    const first = await seed({ deadline: "2026-09-20" });
    const last = await seed({ deadline: "2026-09-30" });
    await seed({ deadline: "2026-10-01" });
    await seed({ deadline: null });

    expect(ids(await search("deadlineFrom=2026-09-20&deadlineTo=2026-09-30"))).toEqual([first, last].sort());
  });

  it("filters by announcement date — the agency's date, never ingestion time", async () => {
    const august = await seed({ announcedAt: "2026-08-31" });
    await seed({ announcedAt: "2026-09-01" });
    await seed({ announcedAt: null });

    expect(ids(await search("from=2026-08-01&to=2026-08-31"))).toEqual([august]);
  });

  it("filters by extracted status, keeping closed and awarded TORs browsable", async () => {
    const awarded = await seed({ status: "awarded" });
    await seed({ status: "announced" });

    expect(ids(await search("status=awarded"))).toEqual([awarded]);
  });

  it("treats open as announced with a deadline today or later in Bangkok, or none stated", async () => {
    // NOW is 10:00 on 16 Sep in Bangkok.
    const today = await seed({ deadline: "2026-09-16" });
    const later = await seed({ deadline: "2026-10-01" });
    const unstated = await seed({ deadline: null });
    await seed({ deadline: "2026-09-15" });
    await seed({ status: "closed", deadline: "2026-10-01" });

    expect(ids(await search("open=true"))).toEqual([today, later, unstated].sort());

    // Every row carries the same verdict the filter used, so the screen need not recompute it.
    const response = await request(buildTestApp()).get("/api/v1/tors");
    const openIds = response.body.items.filter((item: { open: boolean }) => item.open).map((item: { id: string }) => item.id);
    expect(openIds.sort()).toEqual([today, later, unstated].sort());
  });

  it("matches a Thai keyword inside a longer title — the substring $text cannot find", async () => {
    const road = await seed({ title: "จ้างก่อสร้างถนนคอนกรีตเสริมเหล็ก" });
    await seed({ title: "ซื้อเครื่องคอมพิวเตอร์" });

    expect(ids(await search(`q=${encodeURIComponent("ก่อสร้าง")}`))).toEqual([road]);
  });

  it("treats keyword punctuation literally, not as a pattern", async () => {
    await seed({ title: "จ้างเหมาบริการ" });
    expect((await search(`q=${encodeURIComponent(".*")}`)).total).toBe(0);
  });

  it("matches a keyword typed with its Thai marks in a different order (NFC)", async () => {
    // Typed tone mark before the lower vowel: the same visible "ปู่", a different
    // code-point sequence until NFC puts the marks in canonical order.
    const typed = "ปู่";
    expect(typed).not.toBe("ปู่");
    const repair = await seed({ title: "จ้างซ่อมศาลาปู่เจ้า" });

    expect(ids(await search(`q=${encodeURIComponent(typed)}`))).toEqual([repair]);
  });
});

describe("GET /tors — filters compose", () => {
  it("applies agency, category, budget, deadline and keyword together (AND across parameters)", async () => {
    const match = await seed({
      title: "จ้างก่อสร้างอาคารเรียน",
      agency: "สำนักการศึกษา",
      category: "งานก่อสร้าง-อาคาร",
      budget: 3_000_000,
      deadline: "2026-09-25",
    });
    await seed({ title: "จ้างก่อสร้างอาคารเรียน", agency: "สำนักการศึกษา", category: "งานก่อสร้าง-อาคาร", budget: 3_000_000, deadline: "2026-11-25" });
    await seed({ title: "จ้างก่อสร้างอาคารเรียน", agency: "สำนักการศึกษา", category: "งานก่อสร้าง-อาคาร", budget: 30_000_000, deadline: "2026-09-25" });
    await seed({ title: "จ้างก่อสร้างอาคารเรียน", agency: "สำนักการโยธา", category: "งานก่อสร้าง-อาคาร", budget: 3_000_000, deadline: "2026-09-25" });
    await seed({ title: "ซื้อโต๊ะเรียน", agency: "สำนักการศึกษา", category: "งานก่อสร้าง-อาคาร", budget: 3_000_000, deadline: "2026-09-25" });

    const body = await search(
      [
        `agency=${encodeURIComponent("สำนักการศึกษา")}`,
        `category=${encodeURIComponent("งานก่อสร้าง-อาคาร")}`,
        "minBudget=1000000",
        "maxBudget=5000000",
        "deadlineFrom=2026-09-16",
        "deadlineTo=2026-09-30",
        `q=${encodeURIComponent("อาคาร")}`,
      ].join("&"),
    );

    expect(ids(body)).toEqual([match]);
    expect(body.total).toBe(1);
  });
});

describe("GET /tors — pagination", () => {
  it("walks every record exactly once by cursor, newest announcement first, undated last", async () => {
    const seeded: string[] = [];
    for (let i = 0; i < 7; i += 1) seeded.push(await seed({ announcedAt: `2026-08-${String(10 + (i % 3)).padStart(2, "0")}` }));
    for (let i = 0; i < 3; i += 1) seeded.push(await seed({ announcedAt: null }));

    const walked: Array<{ id: string; announcedAt: string | null }> = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await request(buildTestApp()).get(
        `/api/v1/tors?pageSize=3${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(10);
      walked.push(...response.body.items);
      cursor = response.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(4);
    expect(walked.map((item) => item.id).sort()).toEqual(seeded.sort());
    const dates = walked.map((item) => item.announcedAt);
    expect(dates.slice(-3)).toEqual([null, null, null]);
    const dated = dates.slice(0, 7) as string[];
    expect([...dated].sort().reverse()).toEqual(dated);
  });
});

describe("GET /tors — input is primitives only", () => {
  it("rejects an operator object before it can reach a query", () => {
    expect(() => parseSearchQuery({ agency: { $ne: "x" } }, config.search)).toThrow();
    expect(() => parseSearchQuery({ minBudget: { $gt: 0 } }, config.search)).toThrow();
    expect(() => parseSearchQuery({ q: ["a", "b"] }, config.search)).toThrow();
  });

  it.each([
    ["pageSize=abc"],
    [`pageSize=${config.search.maxPageSize + 1}`],
    ["minBudget=-5"],
    ["deadlineFrom=2026-02-30"],
    ["from=16/09/2026"],
    ["status=suspicious"],
    ["open=yes"],
    ["cursor=not-a-cursor"],
    [`q=${"ก".repeat(config.search.queryMaxChars + 1)}`],
  ])("answers 400 for %s", async (query) => {
    const response = await request(buildTestApp()).get(`/api/v1/tors?${encodeURI(query)}`);
    expect(response.status).toBe(400);
  });

  it("ignores a bracketed operator key, which Express's simple parser leaves as a literal name", async () => {
    await seed();
    const body = await search("agency[$ne]=x");
    expect(body.total).toBe(1);
  });
});

describe("GET /tors/facets", () => {
  it("counts the agencies and categories that occur, most frequent first, and the budget range", async () => {
    await seed({ agency: "สำนักการโยธา", category: "งานก่อสร้าง-ทาง", budget: 100_000 });
    await seed({ agency: "สำนักการโยธา", category: "ซื้อครุภัณฑ์", budget: 900_000 });
    await seed({ agency: "สำนักงานเขตบางรัก", category: "งานก่อสร้าง-ทาง", budget: null });
    await seed({ agency: "สำนักงานเขตลับ", restricted: true, budget: 99_000_000 });

    const response = await request(buildTestApp()).get("/api/v1/tors/facets");

    expect(response.status).toBe(200);
    expect(response.body.agencies).toEqual([
      { value: "สำนักการโยธา", count: 2 },
      { value: "สำนักงานเขตบางรัก", count: 1 },
    ]);
    expect(response.body.categories[0]).toEqual({ value: "งานก่อสร้าง-ทาง", count: 2 });
    expect(response.body.budget).toEqual({ min: 100_000, max: 900_000 });
  });
});

describe("GET /tors/:id", () => {
  it("returns every field with its confidence, provenance and source, and minimises contact data", async () => {
    const id = await seed({ contact: "นายสมชาย ใจดี โทร 081 234 5678 ฝ่ายโยธา 02 123 4567" });

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}`);

    expect(response.status).toBe(200);
    expect(response.body.fields.budget).toEqual({ raw: "1000000", value: 1_000_000, confidence: 0.97, verified: true });
    expect(response.body.sourceUrl).toBe("https://webportal.bangkok.go.th/tor.pdf");
    expect(response.body.fields.contact.raw).toContain("02 123 4567");
    expect(response.body.fields.contact.raw).not.toContain("081");
    expect(response.body.fields.contact.raw).not.toContain("สมชาย");
    expect(JSON.stringify(response.body)).not.toContain("evidence");
  });

  it("links the project's page on e-GP when the TOR was collected from it, and nothing otherwise", async () => {
    const collected = await seed();
    await tors(db).updateOne(
      { contentHash: `search-test-${seq}` },
      {
        $set: {
          sourceProject: {
            system: "bma-egp",
            projectId: "ffe2ca8d-b909-4a3e-aa2f-1509051f5042",
            projectNumber: "69099198268",
          },
        },
      },
    );
    const uploaded = await seed();

    const withProject = await request(buildTestApp()).get(`/api/v1/tors/${collected}`);
    const withoutProject = await request(buildTestApp()).get(`/api/v1/tors/${uploaded}`);

    expect(withProject.body.sourceProject).toEqual({
      system: "bma-egp",
      projectNumber: "69099198268",
      url: "https://egp2.bangkok.go.th/project-detail/ffe2ca8d-b909-4a3e-aa2f-1509051f5042",
    });
    expect(withoutProject.body.sourceProject).toBeNull();
  });

  it("says when a value came from the source system rather than AI (NFR-F6)", async () => {
    const id = await seed();
    await tors(db).updateOne(
      { contentHash: `search-test-${seq}` },
      { $set: { "fields.budget": { raw: "5961000", value: 5_961_000, confidence: 1, verified: true, origin: "source" } } },
    );

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}`);

    expect(response.body.fields.budget.origin).toBe("source");
    expect(response.body.fields.title).not.toHaveProperty("origin");
  });

  it("names the document a linked value was read from", async () => {
    const id = await seed({ deadline: "2026-09-17" });
    await tors(db).updateOne(
      { contentHash: `search-test-${seq}` },
      { $set: { "fields.deadline.fromDocument": "6aaa7067673879f45a468199" } },
    );

    const response = await request(buildTestApp()).get(`/api/v1/tors/${id}`);

    expect(response.body.fields.deadline.fromDocument).toBe("6aaa7067673879f45a468199");
  });

  it.each([
    ["a restricted record", { restricted: true }],
    ["an unpublished record", { state: "queued" }],
  ])("answers 404 for %s", async (_label, overrides) => {
    const id = await seed(overrides as Seed);
    expect((await request(buildTestApp()).get(`/api/v1/tors/${id}`)).status).toBe(404);
  });

  it("answers 404 for a malformed id", async () => {
    expect((await request(buildTestApp()).get("/api/v1/tors/not-an-id")).status).toBe(404);
  });
});
