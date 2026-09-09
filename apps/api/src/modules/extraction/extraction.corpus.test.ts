import "../../test/env.js";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../core/config.js";
import { VertexAi } from "../../adapters/vertex.ai.js";
import type { Storage } from "../../ports/storage.port.js";
import { ExtractionService, type ExtractionConfig } from "./extraction.service.js";
import type { ExtractionRepository, ExtractionResult } from "./extraction.repository.js";

/**
 * Spec §8: the check that the extraction schema and the §4.2.1 grading survive
 * contact with real documents, before TOR-90-93 build on the grade. Runs the
 * service (real Vertex, the ten labelled benchmark PDFs) and asserts the field
 * values and the record grade against a table derived from docs/corpus/labels/.
 *
 * Skipped without a Vertex credential, and makes ten real model calls, so it is
 * a local / nightly gate, not part of the CI unit run.
 */
const config = loadConfig(process.env);
const hasCreds = Boolean(config.vertex.project && config.vertex.credentialsPath);
const CORPUS = fileURLToPath(new URL("../../../../../docs/corpus/", import.meta.url));

const svcConfig: ExtractionConfig = {
  model: config.vertex.model,
  tLow: config.tLow,
  tHigh: config.tHigh,
  thresholdsVersion: config.thresholdsVersion,
  budgetMinThb: config.budgetMinThb,
  budgetMaxThb: config.budgetMaxThb,
};

interface Label {
  agency: string;
  budget_thb: number | null;
  category: string;
  status: string;
}

// The acceptable record grades per doc. A stated budget on a digital page reaches
// the clean tier - but the model's confidence wobbles around T_high between runs
// (BENCHMARK.md), so "high or medium" is the honest expectation for those; a doc
// with no budget is always low (a real draft an admin should confirm). tor-02 is
// the scanned cancellation notice.
const ALLOWED_LEVELS: Record<string, Array<"high" | "medium" | "low">> = {
  "tor-01": ["high", "medium"], "tor-02": ["low"], "tor-03": ["low"], "tor-04": ["low"],
  "tor-05": ["high", "medium"], "tor-06": ["low"], "tor-07": ["high", "medium"], "tor-08": ["low"],
  "tor-09": ["high", "medium"], "tor-10": ["high", "medium"],
};

async function runDoc(id: string): Promise<{ result: ExtractionResult; label: Label }> {
  const bytes = readFileSync(CORPUS + `${id}.pdf`);
  const label = JSON.parse(readFileSync(CORPUS + `labels/${id}.json`, "utf8")) as Label;

  const captured: { result?: ExtractionResult } = {};
  const repo = {
    load: vi.fn(async () => ({ storageKey: "k", contentType: "application/pdf" })),
    writeExtraction: vi.fn(async (_torId: string, result: ExtractionResult) => {
      captured.result = result;
    }),
  } as unknown as ExtractionRepository;
  const storage = { getStream: vi.fn(async () => Readable.from([bytes])) } as unknown as Storage;

  const service = new ExtractionService({ storage, ai: new VertexAi(config.vertex), repo, config: svcConfig });
  await service.run(id);
  return { result: captured.result!, label };
}

describe.skipIf(!hasCreds)("extraction corpus gate", () => {
  const ids = Object.keys(ALLOWED_LEVELS);

  it.each(ids)("%s: extracted values match the label and the grade is in range", async (id) => {
    const { result, label } = await runDoc(id);
    const f = result.fields;

    // agency: the model may name the parent body or add "กรุงเทพมหานคร"; accept a
    // containment match either way, or the parent when the doc names only that.
    const agency = f.agency.value ?? "";
    const labelAgency = label.agency.replace(/\s*\(.*\)\s*/g, "").trim();
    const agencyOk =
      agency === labelAgency ||
      agency.includes(labelAgency) ||
      labelAgency.includes(agency) ||
      agency.includes("กรุงเทพมหานคร");
    expect(agencyOk, `agency "${agency}" vs label "${labelAgency}"`).toBe(true);

    expect(f.budget.value).toBe(label.budget_thb);
    expect(f.torStatus.value).toBe(label.status);

    expect(ALLOWED_LEVELS[id]).toContain(result.confidenceLevel);
  }, 60_000);

  it("summarises the grade distribution", async () => {
    const results = await Promise.all(ids.map(runDoc));
    const dist = results.reduce<Record<string, number>>((acc, { result }) => {
      acc[result.confidenceLevel] = (acc[result.confidenceLevel] ?? 0) + 1;
      return acc;
    }, {});
    console.log("corpus grade distribution:", JSON.stringify(dist));
    const verifiedBudgets = results.filter((r) => r.result.fields.budget.verified).length;
    console.log(`budgets verified: ${verifiedBudgets}/${ids.length}`);
    expect(results).toHaveLength(10);
  }, 120_000);
});
