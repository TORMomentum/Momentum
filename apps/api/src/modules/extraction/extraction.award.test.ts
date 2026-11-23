import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AwardResult } from "@tor-radar/shared";
import type { Ai, RawAward, RawField } from "../../ports/ai.port.js";
import type { Storage } from "../../ports/storage.port.js";
import type { ExtractionRepository } from "./extraction.repository.js";
import { ExtractionService, type ExtractionConfig } from "./extraction.service.js";

const rf = <T>(value: T | null, confidence = 0.99): RawField<T> => ({ raw: value === null ? "" : String(value), value, confidence, evidence: "-" });

const config: ExtractionConfig = {
  model: "gemini-3.5-flash",
  tLow: 0.8,
  tHigh: 0.95,
  thresholdsVersion: "2026-09-03",
  budgetMinThb: 10_000,
  budgetMaxThb: 100_000_000_000,
  timezone: "Asia/Bangkok",
};

function fakes(raw: Partial<RawAward>, project: string | null = "69099218130") {
  const storage = { getStream: vi.fn(async () => Readable.from([Buffer.from("%PDF-1.7 award")])) } as unknown as Storage;
  const extractAward = vi.fn(async () => ({
    winner: rf("บริษัท สยามก่อสร้าง จำกัด"),
    price: rf<number>(1_250_000),
    announcementDate: rf("2026-11-20"),
    modelVersion: "gemini-3.5-flash-001",
    usage: { inputTokens: 2_000, outputTokens: 120 },
    ...raw,
  }));
  const extract = vi.fn();
  const repo = {
    load: vi.fn(async () => ({
      storageKey: "k",
      contentHash: "h",
      contentType: "application/pdf",
      knownFields: {},
      sourceAnnouncedAt: new Date("2026-11-20T00:00:00Z"),
      documentType: "award" as const,
      sourceProject: project ? { system: "national-egp", projectId: project } : null,
      annexes: [],
      createdAt: new Date("2026-11-24T00:00:00Z"),
    })),
    writeAward: vi.fn<(id: string, award: AwardResult, meta: unknown) => Promise<void>>(async () => {}),
    linkAward: vi.fn(async () => 1),
    writeExtraction: vi.fn(),
  };
  const ai = { extract, extractAward } as unknown as Ai;
  return { repo, extract, extractAward, service: new ExtractionService({ storage, ai, repo: repo as unknown as ExtractionRepository, config }) };
}

describe("ExtractionService.run — a winner announcement (TOR-221)", () => {
  it("reads the award with its own call, stores it, and links it to the project's TORs and winner stage", async () => {
    const { service, repo, extract } = fakes({});
    await service.run("award-1");

    expect(extract).not.toHaveBeenCalled();
    expect(repo.writeExtraction).not.toHaveBeenCalled();
    const [id, award, meta] = repo.writeAward.mock.calls[0]!;
    expect(id).toBe("award-1");
    expect(award).toMatchObject({
      recordId: "award-1",
      winner: { value: "บริษัท สยามก่อสร้าง จำกัด" },
      winnerKind: "juristic",
      price: { raw: "1250000", value: 1_250_000 },
      announcedOn: "2026-11-20",
      unverified: false,
      provenance: { extractModel: "gemini-3.5-flash", modelVersion: "gemini-3.5-flash-001" },
    });
    expect(meta).toMatchObject({ confidenceLevel: "high", announcedAt: new Date("2026-11-20T00:00:00Z") });
    expect(repo.linkAward).toHaveBeenCalledWith("69099218130", award, ["W0", "W2"]);
  });

  it("marks a reading below T_high unverified, graded by its weaker value", () => {
    const { service, repo } = fakes({ price: rf<number>(1_250_000, 0.85) });
    return service.run("award-1").then(() => {
      const [, award, meta] = repo.writeAward.mock.calls[0]!;
      expect(award.unverified).toBe(true);
      expect(meta).toMatchObject({ confidenceLevel: "medium" });
    });
  });

  it("keeps no price outside what any budget can be, and grades the reading low", async () => {
    const { service, repo } = fakes({ price: rf<number>(5) });
    await service.run("award-1");
    const [, award, meta] = repo.writeAward.mock.calls[0]!;
    expect(award.price.value).toBeNull();
    expect(award.price.raw).toBe("5");
    expect(meta).toMatchObject({ confidenceLevel: "low" });
  });

  it("classes a natural person's win as individual, so the public never sees the name", async () => {
    const { service, repo } = fakes({ winner: rf("นายสมชาย ใจดี") });
    await service.run("award-1");
    expect(repo.writeAward.mock.calls[0]![1].winnerKind).toBe("individual");
  });

  it("stores an announcement with no project, linking nothing", async () => {
    const { service, repo } = fakes({}, null);
    await service.run("award-1");
    expect(repo.writeAward).toHaveBeenCalledOnce();
    expect(repo.linkAward).not.toHaveBeenCalled();
  });
});
