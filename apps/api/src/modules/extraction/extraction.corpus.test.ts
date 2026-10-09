import "../../test/env.js";
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../core/config.js";
import { VertexAi } from "../../adapters/vertex.ai.js";
import type { Storage } from "../../ports/storage.port.js";
import { ExtractionService, type ExtractionConfig } from "./extraction.service.js";
import type { ExtractionRepository, ExtractionResult } from "./extraction.repository.js";

/**
 * Spec §8: prove the extraction schema and the §4.2.1 grading survive contact
 * with real documents, before the rest of TOR-88 builds on the grade. Runs the
 * service once over the ten labelled benchmark PDFs (real Vertex) and checks the
 * result in aggregate - the model is not deterministic (BENCHMARK.md), so this
 * asserts "at least 9/10 field values match the labels" and a grade distribution
 * in range, not an exact per-doc table.
 *
 * Skipped without a Vertex credential; makes ten real model calls, so it is a
 * local / nightly gate, not part of the CI unit run.
 */
const config = loadConfig(process.env);
// The key file must EXIST, not merely be named in .env: otherwise a developer
// without the secret gets a failing suite instead of a skipped one.
const hasCreds = Boolean(
  config.vertex.project && config.vertex.credentialsPath && existsSync(config.vertex.credentialsPath),
);
const CORPUS = fileURLToPath(new URL("../../../../../docs/corpus/", import.meta.url));

const svcConfig: ExtractionConfig = {
  model: config.vertex.model,
  tLow: config.tLow,
  tHigh: config.tHigh,
  thresholdsVersion: config.thresholdsVersion,
  budgetMinThb: config.budgetMinThb,
  budgetMaxThb: config.budgetMaxThb,
  timezone: config.stats.timezone,
};

interface Label {
  agency: string;
  budget_thb: number | null;
  category: string;
  status: string;
}

// A stated budget on a digital page reaches the clean tier - but the model's
// confidence wobbles around T_high between runs, so "high or medium" is the
// honest expectation; a doc with no budget is always low.
const NEVER_LOW = new Set(["tor-01", "tor-05", "tor-07", "tor-09", "tor-10"]);
const ALWAYS_LOW = new Set(["tor-02", "tor-03", "tor-04", "tor-06", "tor-08"]);

async function runDoc(id: string): Promise<{ result: ExtractionResult; label: Label }> {
  const bytes = readFileSync(CORPUS + `${id}.pdf`);
  const label = JSON.parse(readFileSync(CORPUS + `labels/${id}.json`, "utf8")) as Label;
  const captured: { result?: ExtractionResult } = {};
  const repo = {
    load: vi.fn(async () => ({ storageKey: "k", contentType: "application/pdf" })),
    writeExtraction: vi.fn(async (_t: string, r: ExtractionResult) => {
      captured.result = r;
    }),
  } as unknown as ExtractionRepository;
  const storage = { getStream: vi.fn(async () => Readable.from([bytes])) } as unknown as Storage;
  await new ExtractionService({ storage, ai: new VertexAi(config.vertex), repo, config: svcConfig }).run(id);
  return { result: captured.result!, label };
}

const agencyMatches = (got: string, label: string) => {
  const l = label.replace(/\s*\(.*\)\s*/g, "").trim();
  return got === l || got.includes(l) || l.includes(got) || got.includes("กรุงเทพมหานคร");
};

// Having a Vertex credential is NOT consent to spend it. Once the development
// .env carried the key the app needs, every `npm test` made ten real, billed
// model calls — and hung on the network when they stalled. The benchmark now
// runs only when it is asked for: RUN_VERTEX_CORPUS=1 npm test.
const optedIn = process.env.RUN_VERTEX_CORPUS === "1";

describe.skipIf(!hasCreds || !optedIn)("extraction corpus gate", () => {
  const ids = [...NEVER_LOW, ...ALWAYS_LOW];
  let runs: Array<{ id: string; result: ExtractionResult; label: Label }>;

  beforeAll(async () => {
    runs = await Promise.all(ids.map(async (id) => ({ id, ...(await runDoc(id)) })));
    const dist = runs.reduce<Record<string, number>>((a, { result }) => {
      a[result.confidenceLevel] = (a[result.confidenceLevel] ?? 0) + 1;
      return a;
    }, {});
    console.table(
      runs.map(({ id, result, label }) => ({
        id,
        level: result.confidenceLevel,
        budget: result.fields.budget.value,
        budgetLabel: label.budget_thb,
        status: result.fields.torStatus.value,
        tags: (result.fields.qualifications.tags ?? []).join(","),
      })),
    );
    console.log("grade distribution:", JSON.stringify(dist));
  }, 240_000);

  it("extracts budget correctly on at least 9 of 10 documents", () => {
    const ok = runs.filter(({ result, label }) => result.fields.budget.value === label.budget_thb);
    expect(ok.length).toBeGreaterThanOrEqual(9);
  });

  it("extracts the agency on at least 9 of 10 documents", () => {
    const ok = runs.filter(({ result, label }) => agencyMatches(result.fields.agency.value ?? "", label.agency));
    expect(ok.length).toBeGreaterThanOrEqual(9);
  });

  it("extracts the coarse status on at least 9 of 10 documents", () => {
    const ok = runs.filter(({ result, label }) => result.fields.torStatus.value === label.status);
    expect(ok.length).toBeGreaterThanOrEqual(9);
  });

  it("grades every no-budget draft low and never grades a budgeted digital TOR low", () => {
    for (const { id, result } of runs) {
      if (ALWAYS_LOW.has(id)) expect(result.confidenceLevel, id).toBe("low");
      if (NEVER_LOW.has(id)) expect(result.confidenceLevel, id).not.toBe("low");
    }
  });

  it("maps qualifications to at least one taxonomy tag on the construction TORs", () => {
    const construction = runs.filter(({ label }) => label.category.startsWith("งานก่อสร้าง"));
    expect(construction.length).toBeGreaterThan(0);
    for (const { id, result } of construction) {
      expect((result.fields.qualifications.tags ?? []).length, id).toBeGreaterThanOrEqual(1);
    }
  });
});
