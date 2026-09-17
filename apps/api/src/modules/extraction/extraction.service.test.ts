import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { TorFields } from "@tor-radar/shared";
import { DocumentUnreadableError } from "../../core/errors.js";
import type { Ai, RawExtraction, RawField } from "../../ports/ai.port.js";
import type { Storage } from "../../ports/storage.port.js";
import type { ExtractionRepository, ExtractionResult, LinkedDeadline } from "./extraction.repository.js";
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

interface FakeTarget {
  knownFields?: Partial<TorFields>;
  sourceAnnouncedAt?: Date | null;
  documentType?: "tor" | "invitation";
  sourceProject?: { system: "bma-egp"; projectId: string } | null;
  invitationDeadline?: LinkedDeadline | null;
}

function fakes(over: { ai?: Partial<Ai>; bytes?: Buffer } & FakeTarget = {}) {
  const storage = {
    getStream: vi.fn(async () => Readable.from([over.bytes ?? DIGITAL_PDF])),
  } as unknown as Storage;
  const ai = { extract: vi.fn(async () => cleanExtraction()), ...over.ai } as Ai;
  const load = vi.fn(async () => ({
    storageKey: "k",
    contentType: "application/pdf",
    knownFields: over.knownFields ?? {},
    sourceAnnouncedAt: over.sourceAnnouncedAt ?? null,
    documentType: over.documentType ?? "tor",
    sourceProject: over.sourceProject ?? null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }));
  const writeExtraction = vi.fn<(torId: string, result: ExtractionResult) => Promise<void>>(async () => {});
  const findInvitationDeadline = vi.fn(async () => over.invitationDeadline ?? null);
  const linkDeadline = vi.fn<(projectId: string, deadline: LinkedDeadline) => Promise<void>>(async () => {});
  const fakeRepo = { load, writeExtraction, findInvitationDeadline, linkDeadline };
  const repo = fakeRepo as unknown as ExtractionRepository;
  return { storage, ai, repo: fakeRepo, service: new ExtractionService({ storage, ai, repo, config }) };
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

  it("keeps the agency and budget the source stated at intake, whatever the model reads", async () => {
    const agency = { raw: "สำนักการโยธา", value: "สำนักการโยธา", confidence: 1, verified: true, origin: "source" as const };
    const budget = { raw: "5961000", value: 5_961_000, currency: "THB", confidence: 1, verified: true, origin: "source" as const };
    const { service, repo } = fakes({ knownFields: { agency, budget } });

    await service.run("tor-1");

    const [, result] = repo.writeExtraction.mock.calls[0];
    expect(result.fields.agency).toEqual(agency);
    expect(result.fields.budget).toEqual(budget);
    // The rest is still the model's reading.
    expect(result.fields.title.value).toBe("ประกวดราคาจ้างก่อสร้างขุดลอกคลองบางน้อย");
  });

  describe("e-GP project linking", () => {
    const project = { system: "bma-egp" as const, projectId: "9104a1e4-1371-4aa7-b73d-665fe5300654" };
    const invitationDeadline = {
      raw: "วันที่ ๑๗ กันยายน ๒๕๖๙ ระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น.",
      value: "2026-09-17",
      confidence: 0.95,
      verified: true,
    };

    it("keeps the announcement date the source stated over the one the model read", async () => {
      const { service, repo } = fakes({ sourceAnnouncedAt: new Date("2026-08-26T00:00:00Z") });

      await service.run("tor-1");

      const [, result] = repo.writeExtraction.mock.calls[0];
      expect(result.announcedAt).toEqual(new Date("2026-08-26T00:00:00Z"));
    });

    it("gives a TOR the deadline its project's invitation already yielded, naming the invitation", async () => {
      const { service, repo } = fakes({
        sourceProject: project,
        invitationDeadline: { invitationId: "inv-1", field: invitationDeadline },
      });

      await service.run("tor-1");

      expect(repo.findInvitationDeadline).toHaveBeenCalledWith(project.projectId);
      const [, result] = repo.writeExtraction.mock.calls[0];
      expect(result.fields.deadline).toEqual({ ...invitationDeadline, fromDocument: "inv-1" });
      expect(repo.linkDeadline).not.toHaveBeenCalled();
    });

    it("pushes an invitation's deadline onto its project's TORs when the invitation comes second", async () => {
      const extraction = cleanExtraction();
      extraction.deadline = { raw: invitationDeadline.raw, value: "2026-09-17", confidence: 0.95, evidence: "ข้อ ๒" };
      const { service, repo } = fakes({
        documentType: "invitation",
        sourceProject: project,
        ai: { extract: vi.fn(async () => extraction) },
      });

      await service.run("inv-1");

      expect(repo.findInvitationDeadline).not.toHaveBeenCalled();
      expect(repo.linkDeadline).toHaveBeenCalledOnce();
      const [projectId, linked] = repo.linkDeadline.mock.calls[0];
      expect(projectId).toBe(project.projectId);
      expect(linked.invitationId).toBe("inv-1");
      expect(linked.field.value).toBe("2026-09-17");
    });

    it("does not link a deadline that falls before the invitation's own announcement", async () => {
      // The real case: a scan where ๙ was read as ๕, turning 2569 into 2565.
      const extraction = cleanExtraction();
      extraction.deadline = { raw: "๒๔ กันยายน ๒๕๖๕", value: "2022-09-24", confidence: 1, evidence: "ข้อ ๒" };
      const { service, repo } = fakes({
        documentType: "invitation",
        sourceProject: project,
        sourceAnnouncedAt: new Date("2026-09-16T00:00:00Z"),
        ai: { extract: vi.fn(async () => extraction) },
      });

      await service.run("inv-1");

      const [, result] = repo.writeExtraction.mock.calls[0];
      expect(result.reviewReasons).toContain("deadline-before-announcement");
      expect(repo.linkDeadline).not.toHaveBeenCalled();
    });

    it("links nothing when the invitation states no deadline", async () => {
      const { service, repo } = fakes({ documentType: "invitation", sourceProject: project });

      await service.run("inv-1");

      expect(repo.linkDeadline).not.toHaveBeenCalled();
    });

    it("links nothing for a record that belongs to no source project", async () => {
      const { service, repo } = fakes();

      await service.run("tor-1");

      expect(repo.findInvitationDeadline).not.toHaveBeenCalled();
      expect(repo.linkDeadline).not.toHaveBeenCalled();
    });
  });
});
