import { describe, expect, it } from "vitest";
import type { RawExtraction, RawField } from "../../ports/ai.port.js";
import { grade, type GradingContext } from "./extraction.grading.js";

const rf = <T = string>(value: T | null, confidence = 0.99, raw?: string): RawField<T> => ({
  raw: raw ?? (value === null ? "" : String(value)),
  value,
  confidence,
  evidence: "-",
});

/** A clean digital TOR: every critical field present and confident. */
function goodDigital(over: Partial<RawExtraction> = {}): RawExtraction {
  return {
    title: rf("ประกวดราคาจ้างก่อสร้างขุดลอกคลองบางน้อย"),
    agency: rf("สำนักงานเขตทวีวัฒนา"),
    budget: rf<number>(5_524_000),
    category: rf("งานก่อสร้าง-ชลประทาน"),
    scopeSummary: rf("ขุดลอกคลองบางน้อย จากที่ดินเอกชนถึงถนนกาญจนาภิเษก เพื่อเพิ่มประสิทธิภาพการระบายน้ำ"),
    qualifications: rf<string[]>(["ขึ้นทะเบียนงานก่อสร้างชั้น 6"]),
    deadline: rf("2026-02-01"),
    contact: rf<string>(null, 1),
    status: rf<"announced" | "closed" | "awarded" | "cancelled">("announced"),
    announcementDate: rf("2026-01-05"),
    procurementMethod: rf("e-bidding"),
    referenceNo: rf<string>(null, 1),
    modelVersion: "gemini-3.5-flash",
    ...over,
  };
}

const ctx = (over: Partial<GradingContext> = {}): GradingContext => ({
  hasTextLayer: true,
  announcedAt: new Date("2026-01-05"),
  tLow: 0.8,
  tHigh: 0.95,
  budgetMinThb: 10_000,
  budgetMaxThb: 100_000_000_000,
  ...over,
});

describe("grade — record level", () => {
  it("a clean digital TOR with every critical field confident grades high", () => {
    const result = grade(goodDigital(), ctx());
    expect(result.confidenceLevel).toBe("high");
    expect(result.unverified).toBe(false);
    expect(result.fields.budget.verified).toBe(true);
    expect(result.fields.budget.currency).toBe("THB");
  });

  it("a critical field with medium confidence pulls the record to medium, not low", () => {
    const result = grade(goodDigital({ budget: rf<number>(5_524_000, 0.88) }), ctx());
    expect(result.confidenceLevel).toBe("medium");
    expect(result.fields.budget.verified).toBe(false);
    expect(result.unverified).toBe(true);
  });

  it("a missing budget makes the record low and queues it", () => {
    const result = grade(goodDigital({ budget: rf<number>(null, 1) }), ctx());
    expect(result.confidenceLevel).toBe("low");
  });

  it("a critical field below T_low counts as missing", () => {
    const result = grade(goodDigital({ agency: rf("สำนักงานเขตทวีวัฒนา", 0.5) }), ctx());
    expect(result.confidenceLevel).toBe("low");
  });
});

describe("grade — Pass 1 structural checks", () => {
  it("a budget read off a scan is never verified, even at confidence 1", () => {
    const result = grade(goodDigital(), ctx({ hasTextLayer: false }));
    expect(result.fields.budget.verified).toBe(false);
    // agency and title still fine on a scan, but budget/deadline structurally fail
    expect(result.confidenceLevel).toBe("low");
  });

  it("a short scope summary is not verified", () => {
    const result = grade(goodDigital({ scopeSummary: rf("สั้นไป") }), ctx());
    expect(result.fields.scopeSummary.verified).toBe(false);
  });

  it("a deadline before the announcement date is not verified and trips sanity", () => {
    const result = grade(goodDigital({ deadline: rf("2025-12-01") }), ctx());
    expect(result.fields.deadline.verified).toBe(false);
    expect(result.confidenceLevel).toBe("low");
  });
});

describe("grade — Pass 3 sanity checks", () => {
  it("budget outside the plausible band makes the record low", () => {
    const result = grade(goodDigital({ budget: rf<number>(42) }), ctx());
    expect(result.confidenceLevel).toBe("low");
  });

  it("a cancelled TOR that still carries a deadline is low (the benchmark hallucination signature)", () => {
    const result = grade(
      goodDigital({ status: rf<"announced" | "closed" | "awarded" | "cancelled">("cancelled") }),
      ctx(),
    );
    expect(result.confidenceLevel).toBe("low");
  });

  it("three fields sharing an identical raw string is a copy-through failure", () => {
    const same = rf("ประกวดราคาอิเล็กทรอนิกส์", 0.99, "ประกวดราคาอิเล็กทรอนิกส์");
    const result = grade(
      goodDigital({ title: same, category: same, scopeSummary: same }),
      ctx(),
    );
    expect(result.confidenceLevel).toBe("low");
  });
});
