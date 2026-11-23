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
import { MatchingRepository } from "../matching/matching.repository.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { TorsRepository } from "../tors/tors.repository.js";
import { buildTorsRouter } from "../tors/tors.routes.js";
import { TorsService } from "../tors/tors.service.js";
import { EXPORT_HEADER } from "./export.csv.js";
import { buildExportRouter } from "./export.routes.js";
import { ExportService } from "./export.service.js";

const config = loadConfig(process.env);
const NOW = new Date("2026-09-16T03:00:00Z");
const ORIGIN = "https://tor-radar.example";

let db: Db;
let seq = 0;

function field<T>(value: T | null, verified = true): ExtractedField<T> {
  return { raw: value === null ? "" : String(value), value, confidence: 0.97, verified, evidence: "quote" };
}

async function seed(overrides: { agency?: string; deadline?: string | null; restricted?: boolean; title?: string; stage?: TorDocument["stage"] } = {}) {
  seq += 1;
  const now = new Date(Date.UTC(2026, 8, 1, 0, seq));
  const fields: Partial<TorFields> = {
    title: field(overrides.title ?? `จ้างก่อสร้างถนนสายที่ ${seq}`),
    agency: field(overrides.agency ?? "สำนักงานเขตทวีวัฒนา"),
    category: field("งานก่อสร้าง-ทาง"),
    budget: field(1_000_000 + seq),
    deadline: field(overrides.deadline === undefined ? null : overrides.deadline),
    torStatus: field("announced"),
    contact: field("ฝ่ายโยธา โทร 02 123 4567"),
  };
  const doc: TorDocument = {
    contentHash: `export-test-${seq}`,
    storage: { bucket: "tor-raw", key: `tors/2026/09/export-test-${seq}.pdf`, contentType: "application/pdf", bytes: 10 },
    sourceRefs: [{ route: "upload", submittedBy: "admin", submittedAt: now }],
    pipeline: { state: "published", attempts: 1 },
    fields,
    announcedAt: new Date(Date.UTC(2026, 7, 1 + (seq % 28))),
    sourceUrl: "https://webportal.bangkok.go.th/tor.pdf",
    confidenceLevel: "high",
    unverified: false,
    statusHistory: [],
    access: { restricted: overrides.restricted ?? false },
    ...(overrides.stage ? { stage: overrides.stage } : {}),
    duplicateOf: null,
    provenance: {
      ocrModel: "documentai",
      extractModel: "gemini-test",
      modelVersion: "gemini-test-001",
      extractedAt: "2026-09-01T00:00:00.000Z",
      thresholdsVersion: "1",
    },
    createdAt: now,
    updatedAt: now,
  };
  return (await tors(db).insertOne(doc)).insertedId.toString();
}

function buildTestApp(maxRows = 5000) {
  const app = express();
  const service = new TorsService({ repo: new TorsRepository(db), config, now: () => NOW });
  const deps = { config, profiles: new ProfileRepository(db), matching: new MatchingRepository(db, config) };
  app.use(
    "/api/v1/export",
    buildExportRouter({ ...deps, service: new ExportService({ tors: service, maxRows, pageSize: 2, appOrigin: ORIGIN }) }),
  );
  app.use("/api/v1/tors", buildTorsRouter({ ...deps, service, storage: {} as Storage, search: config.search }));
  app.use(errorMiddleware);
  return app;
}

/** Rows as arrays of cells, header first; a minimal RFC 4180 reader for what the export writes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 1; }
    else cell += ch;
  }
  return rows;
}

async function exportCsv(query: string, maxRows?: number) {
  const response = await request(buildTestApp(maxRows)).get(`/api/v1/export/tors.csv?${query}`).buffer(true).parse((res, done) => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => (data += chunk));
    res.on("end", () => done(null, data));
  });
  return { response, text: response.body as string };
}

/** Every id `GET /tors` lists for the query, in order, walking every page. */
async function listedIds(query: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page: { body: { items: Array<{ id: string }>; nextCursor: string | null } } = await request(buildTestApp()).get(
      `/api/v1/tors?${query}&pageSize=3${cursor ? `&cursor=${cursor}` : ""}`,
    );
    ids.push(...page.body.items.map((item) => item.id));
    cursor = page.body.nextCursor;
  } while (cursor);
  return ids;
}

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "export"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  await tors(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("GET /export/tors.csv (TOR-69)", () => {
  it("holds exactly the records GET /tors lists for the same filter, in the same order", async () => {
    await seed({ deadline: "2026-09-25" });
    await seed({ deadline: "2026-09-18" });
    await seed({ deadline: null });
    await seed({ deadline: "2026-10-30", agency: "สำนักงานเขตบางรัก" });
    await seed({ deadline: "2026-09-30" });
    await seed({ restricted: true });

    for (const query of ["", "agency=สำนักงานเขตทวีวัฒนา", "minDaysLeft=7", "open=true"]) {
      const { response, text } = await exportCsv(query);
      expect(response.status, query).toBe(200);
      const rows = parseCsv(text.replace(/^\uFEFF/, ""));
      expect(rows[0]).toEqual([...EXPORT_HEADER]);
      // Rows carry their TOR page link; the id at its end is the record.
      const exported = rows.slice(1).map((row) => row[EXPORT_HEADER.indexOf("หน้า TOR")]!.split("/").pop());
      expect(exported, query).toEqual(await listedIds(query));
    }
  });

  it("answers as a download that is never cached or sniffed, with a BOM for Excel", async () => {
    await seed();
    const { response, text } = await exportCsv("");
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="tor-radar-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-export-total"]).toBe("1");
    expect(response.headers["x-export-truncated"]).toBe("false");
    expect(text.startsWith("\uFEFF")).toBe(true);
  });

  it("stops at EXPORT_MAX_ROWS and says the file is cut short", async () => {
    for (let i = 0; i < 5; i += 1) await seed();
    const { response, text } = await exportCsv("", 3);
    expect(parseCsv(text.replace(/^\uFEFF/, ""))).toHaveLength(1 + 3);
    expect(response.headers["x-export-total"]).toBe("5");
    expect(response.headers["x-export-truncated"]).toBe("true");
  });

  it("carries provenance and source links, and nothing the public list does not show", async () => {
    const id = await seed({ title: '=cmd|"/c calc"!A1' });
    const { text } = await exportCsv("");
    const [header, row] = parseCsv(text.replace(/^\uFEFF/, ""));
    const byHeader = Object.fromEntries(header!.map((name, i) => [name, row![i]]));
    expect(byHeader["ชื่อโครงการ"]).toBe(`'=cmd|"/c calc"!A1`);
    expect(byHeader["โมเดล AI ที่สกัด"]).toBe("gemini-test (gemini-test-001)");
    expect(byHeader["สถานะ"]).toBe("รอประกาศเชิญชวน");
    expect(byHeader["ระดับความมั่นใจ"]).toBe("สูง");
    expect(byHeader["ประกาศต้นทาง"]).toBe("https://webportal.bangkok.go.th/tor.pdf");
    expect(byHeader["หน้า TOR"]).toBe(`${ORIGIN}/tors/${id}`);
    expect(byHeader["เอกสารต้นฉบับ"]).toBe(`${ORIGIN}/tors/${id}/document`);
    // The contact line is extracted but never listed publicly; the export must not carry it either.
    expect(text).not.toContain("02 123 4567");
  });

  it("follows the source's final stage over the extracted status, in the state column and the open filter (TOR-205)", async () => {
    const open = await seed({ deadline: "2026-12-01" });
    const awarded = await seed({ deadline: "2026-12-01", stage: { code: "W0", kind: "awarded", on: "2026-11-20" } });
    const stateOf = async (query: string) => {
      const [header, ...rows] = parseCsv((await exportCsv(query)).text.replace(/^\uFEFF/, ""));
      return Object.fromEntries(rows.map((row) => [row[header!.indexOf("หน้า TOR")]!.split("/").pop(), row[header!.indexOf("สถานะ")]]));
    };
    expect(await stateOf("")).toEqual({ [open]: "เปิดรับข้อเสนอ", [awarded]: "ประกาศผู้ชนะแล้ว" });
    expect(await stateOf("open=true")).toEqual({ [open]: "เปิดรับข้อเสนอ" });
    expect(await stateOf("state=awarded")).toEqual({ [awarded]: "ประกาศผู้ชนะแล้ว" });
  });

  it("refuses a malformed filter, and a match filter without a signed-in vendor", async () => {
    expect((await request(buildTestApp()).get("/api/v1/export/tors.csv?minDaysLeft=-1")).status).toBe(400);
    expect((await request(buildTestApp()).get("/api/v1/export/tors.csv?minBudget=lots")).status).toBe(400);
    expect((await request(buildTestApp()).get("/api/v1/export/tors.csv?minMatch=50")).status).toBe(401);
  });
});
