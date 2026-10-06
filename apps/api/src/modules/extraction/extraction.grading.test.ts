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
    category: rf("งานก่อสร้าง-ชลประทานและระบบน้ำ"),
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

describe("grade — category", () => {
  it("verifies a confident category only when it is on the closed list", () => {
    expect(grade(goodDigital({ category: rf("งานก่อสร้าง-ชลประทานและระบบน้ำ", 0.99) }), ctx()).fields.category.verified).toBe(true);
    expect(grade(goodDigital({ category: rf("ซื้อยา", 0.99) }), ctx()).fields.category.verified).toBe(false);
  });
});

describe("grade — scope items", () => {
  it("verifies a confident whole-number count, and carries nothing when the model gave none", () => {
    expect(grade({ ...goodDigital(), scopeItems: rf<number>(14, 0.97) }, ctx()).fields.scopeItems).toMatchObject({ value: 14, verified: true });
    expect(grade({ ...goodDigital(), scopeItems: rf<number>(null, 0.97) }, ctx()).fields.scopeItems?.verified).toBe(false);
    expect(grade(goodDigital(), ctx()).fields.scopeItems).toBeUndefined();
  });
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

  it("a closed TOR whose deadline has already passed is NOT flagged for that alone", () => {
    // The rule was narrowed in review: a finished procurement legitimately has a
    // past deadline, and the original check flagged every historical closed
    // record that stated one - which is most of them.
    const result = grade(
      goodDigital({
        status: rf<"announced" | "closed" | "awarded" | "cancelled">("closed"),
        deadline: rf("2026-02-01"),
      }),
      ctx({ announcedAt: new Date("2026-01-05") }),
    );
    expect(result.confidenceLevel).not.toBe("low");
  });

  it("a closed TOR whose deadline is still in the future is low", () => {
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = grade(
      goodDigital({
        status: rf<"announced" | "closed" | "awarded" | "cancelled">("closed"),
        deadline: rf(future),
      }),
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

describe("grade — fields the source already stated", () => {
  const sourceBudget = {
    raw: "5961000",
    value: 5_961_000,
    currency: "THB",
    confidence: 1,
    verified: true,
    origin: "source" as const,
  };

  it("a scan whose budget the source stated is not held back by the model's reading of it", () => {
    // Without the source value this record is low with "budget-unreadable" (Pass 1 test above).
    const result = grade(goodDigital(), ctx({ hasTextLayer: false, knownFields: { budget: sourceBudget } }));

    expect(result.fields.budget).toEqual(sourceBudget);
    expect(result.reviewReasons).not.toContain("budget-unreadable");
    expect(result.confidenceLevel).not.toBe("low");
  });

  it("a budget absent from the document is not missing when the source stated it", () => {
    const result = grade(goodDigital({ budget: rf<number>(null, 1) }), ctx({ knownFields: { budget: sourceBudget } }));

    expect(result.reviewReasons).not.toContain("budget-missing");
    expect(result.confidenceLevel).toBe("high");
  });

  it("keeps the stated value, not a different one the model read", () => {
    const result = grade(goodDigital({ budget: rf<number>(7_000_000) }), ctx({ knownFields: { budget: sourceBudget } }));

    expect(result.fields.budget.value).toBe(5_961_000);
    expect(result.fields.budget.origin).toBe("source");
  });

  it("still applies the sanity checks to a stated value", () => {
    const implausible = { ...sourceBudget, raw: "1", value: 1 };
    const result = grade(goodDigital(), ctx({ knownFields: { budget: implausible } }));

    expect(result.reviewReasons).toContain("budget-implausible");
  });

  it("model-read fields stay unmarked", () => {
    const result = grade(goodDigital(), ctx({ knownFields: { budget: sourceBudget } }));
    expect(result.fields.title.origin).toBeUndefined();
  });
});
