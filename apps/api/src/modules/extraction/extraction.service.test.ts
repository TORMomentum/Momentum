import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DocumentUnreadableError } from "../../core/errors.js";
import type { Ai, RawExtraction, RawField } from "../../ports/ai.port.js";
import type { Storage } from "../../ports/storage.port.js";
import type { ExtractionRepository, ExtractionResult } from "./extraction.repository.js";
import { ExtractionService, type ExtractionConfig } from "./extraction.service.js";

const DIGITAL_PDF = readFileSync(fileURLToPath(new URL("../../../../../docs/corpus/tor-01.pdf", import.meta.url)));

const rf = <T = string>(value: T | null, confidence = 0.99): RawField<T> => ({
  raw: value === null ? "" : String(value),
  value,
  confidence,
  evidence: "-",
});

const cleanExtraction = (): RawExtraction => ({
  title: rf("ประกวดราคาจ้างก่อสร้างขุดลอกคลองบางน้อย"),
  agency: rf("สำนักงานเขตทวีวัฒนา"),
  budget: rf<number>(5_524_000),
  category: rf("งานก่อสร้าง-ชลประทาน"),
  scopeSummary: rf("ขุดลอกคลองบางน้อย จากที่ดินเอกชนถึงถนนกาญจนาภิเษก เพื่อเพิ่มประสิทธิภาพการระบายน้ำ"),
  qualifications: rf<string[]>(["ขึ้นทะเบียนงานก่อสร้างชั้น 6"]),
  deadline: rf<string>(null, 1),
  contact: rf<string>(null, 1),
  status: rf<"announced" | "closed" | "awarded" | "cancelled">("announced"),
  announcementDate: rf("2026-01-05"),
  procurementMethod: rf("e-bidding"),
  referenceNo: rf<string>(null, 1),
  modelVersion: "gemini-3.5-flash-001",
});

const config: ExtractionConfig = {
  model: "gemini-3.5-flash",
  tLow: 0.8,
  tHigh: 0.95,
  thresholdsVersion: "2026-09-03",
  budgetMinThb: 10_000,
  budgetMaxThb: 100_000_000_000,
  timezone: "Asia/Bangkok",
};

function fakes(over: { ai?: Partial<Ai>; bytes?: Buffer } = {}) {
  const storage = {
    getStream: vi.fn(async () => Readable.from([over.bytes ?? DIGITAL_PDF])),
  } as unknown as Storage;
  const ai = { extract: vi.fn(async () => cleanExtraction()), ...over.ai } as Ai;
  const load = vi.fn(async () => ({ storageKey: "k", contentType: "application/pdf", createdAt: new Date("2026-01-01T00:00:00Z") }));
  const writeExtraction = vi.fn<(torId: string, result: ExtractionResult) => Promise<void>>(async () => {});
  const repo = { load, writeExtraction } as unknown as ExtractionRepository;
  return { storage, ai, repo: { load, writeExtraction }, service: new ExtractionService({ storage, ai, repo, config }) };
}

describe("ExtractionService.run", () => {
  it("writes the record once, graded, with provenance naming the model version", async () => {
    const { service, repo, ai } = fakes();

    await service.run("tor-1");

    expect(ai.extract).toHaveBeenCalledOnce();
    expect(repo.writeExtraction).toHaveBeenCalledOnce();
    const [, result] = repo.writeExtraction.mock.calls[0];
    // agency and budget (the critical fields) are present, confident, and on a
    // digital page -> high. The missing deadline just leaves that field unverified.
    expect(result.confidenceLevel).toBe("high");
    expect(result.fields.deadline.verified).toBe(false);
    expect(result.provenance.modelVersion).toBe("gemini-3.5-flash-001");
    expect(result.provenance.thresholdsVersion).toBe("2026-09-03");
    expect(result.hasTextLayer).toBe(true);
    expect(result.announcedAt).toEqual(new Date("2026-01-05"));
  });

  it("propagates an Ai failure without writing anything", async () => {
    const { service, repo } = fakes({
      ai: { extract: vi.fn(async () => { throw new DocumentUnreadableError("no title, no agency"); }) },
    });

    await expect(service.run("tor-1")).rejects.toThrow(DocumentUnreadableError);
    expect(repo.writeExtraction).not.toHaveBeenCalled();
  });

  it("treats a scan's budget as unverified and the record as low", async () => {
    const scan = readFileSync(fileURLToPath(new URL("../../../../../docs/corpus/tor-02.pdf", import.meta.url)));
    const { service, repo } = fakes({ bytes: scan });

    await service.run("tor-1");

    const [, result] = repo.writeExtraction.mock.calls[0];
    expect(result.hasTextLayer).toBe(false);
    expect(result.fields.budget.verified).toBe(false);
    expect(result.confidenceLevel).toBe("low");
  });
});
