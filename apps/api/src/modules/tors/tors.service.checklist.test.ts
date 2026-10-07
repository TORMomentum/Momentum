import { describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { TorsService } from "./tors.service.js";
import type { TorsRepository } from "./tors.repository.js";

const config = loadConfig({
  MONGO_URL: "mongodb://mongo:27017/tor_radar",
  INTAKE_API_KEYS: "test-key",
  ADMIN_API_KEYS: "admin-key",
  GCS_BUCKET: "tor-raw",
  GCS_API_ENDPOINT: "http://gcs:4443",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  APP_ORIGIN: "http://localhost:3000",
});

const verified = (value: unknown) => ({ raw: String(value), value, confidence: 0.99, verified: true });

function serviceWith(record: object | null, peers: object[] = []) {
  const repo = {
    loadPublic: async () => record,
    boundsFor: async () => peers,
  } as unknown as TorsRepository;
  return new TorsService({ repo, config });
}

const cohort = { category: "it", month: "2026-09" };

describe("TorsService.detail checklist", () => {
  it("attaches the checklist, with C5 taken from the record's peer bounds", async () => {
    const service = serviceWith(
      {
        id: "tor-1",
        cohort,
        fields: {
          budget: verified(1_000_000),
          category: verified("it"),
          qualifications: { raw: "", value: ["x"], confidence: 0.9, verified: true, tags: ["it-software"] },
        },
        announcedAt: null,
        sourceUrl: null,
        sourceProject: null,
        provenance: null,
        confidenceLevel: "high",
        unverified: false,
        contentHash: "h",
        contentType: "application/pdf",
        createdAt: new Date(),
      },
      [{ category: "it", month: "2026-09", n: 20, q1: 900_000, q3: 1_100_000, iqr: 200_000, lowBound: 600_000, highBound: 1_400_000, mean: 1_000_000, stdDev: 50_000 }],
    );

    const detail = await service.detail("tor-1");

    expect(detail.checklist.checks.find((check) => check.id === "C1")?.result).toBe("pass");
    expect(detail.checklist.checks.find((check) => check.id === "C4")?.result).toBe("pass");
    expect(detail.checklist.checks.find((check) => check.id === "C5")?.result).toBe("pass");
    expect(detail.checklist.checks.find((check) => check.id === "C2")?.result).toBe("not-evaluated");
  });

  it("fails C5 when the budget sits outside the fence of its peers", async () => {
    const service = serviceWith(
      {
        id: "tor-2",
        cohort,
        fields: {
          budget: verified(50_000_000),
          category: verified("it"),
          qualifications: { raw: "", value: ["x"], confidence: 0.9, verified: true, tags: ["it-software"] },
        },
        announcedAt: null,
        sourceUrl: null,
        sourceProject: null,
        provenance: null,
        confidenceLevel: "high",
        unverified: false,
        contentHash: "h",
        contentType: "application/pdf",
        createdAt: new Date(),
      },
      [{ category: "it", month: "2026-09", n: 20, q1: 900_000, q3: 1_100_000, iqr: 200_000, lowBound: 600_000, highBound: 1_400_000, mean: 1_000_000, stdDev: 50_000 }],
    );

    const detail = await service.detail("tor-2");

    expect(detail.checklist.checks.find((check) => check.id === "C5")?.result).toBe("fail");
  });
});
