import { describe, expect, it } from "vitest";
import { checklistFieldsOf, evaluateChecklist, summariseChecklists, type ChecklistInput } from "./checklist.js";

const healthy: ChecklistInput = {
  budget: { value: 1_500_000, verified: true },
  budgetRange: { min: 10_000, max: 100_000_000_000 },
  bidWindow: { announcedOn: "2026-03-05", deadline: { value: "2026-03-19", verified: true } },
  scope: {
    summary: { value: "จ้างก่อสร้างถนนคอนกรีตเสริมเหล็ก ความยาว 1.2 กิโลเมตร พร้อมระบบระบายน้ำและงานทาสีตีเส้นจราจรตามแบบแปลนที่กำหนด".repeat(2), verified: true },
    items: { value: 16, verified: true },
    location: "in_documents",
  },
  thresholds: { minBidWindowDays: 8, minScopeChars: 112, minScopeSections: 6 },
  qualificationTags: ["it-software"],
  qualificationsVerified: true,
  verdict: { kind: "normal" },
};

const resultOf = (input: ChecklistInput, id: string) =>
  evaluateChecklist(input).checks.find((check) => check.id === id);

describe("evaluateChecklist", () => {
  it("passes all five checks for a healthy record", () => {
    const checklist = evaluateChecklist(healthy);

    expect(checklist.checks.map((check) => check.result)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    expect(checklist).toMatchObject({ passed: 5, evaluated: 5 });
  });

  describe("C2, the bid window", () => {
    const withWindow = (announcedOn: string | null, value: string | null, verified = true) =>
      resultOf({ ...healthy, bidWindow: { announcedOn, deadline: { value, verified } } }, "C2");

    it("passes a window at exactly the minimum and fails one day short of it", () => {
      expect(withWindow("2026-03-05", "2026-03-13")?.result).toBe("pass");
      expect(withWindow("2026-03-05", "2026-03-12")?.result).toBe("fail");
    });

    it("counts calendar days across a month and a year boundary", () => {
      expect(withWindow("2026-12-28", "2027-01-05")?.result).toBe("pass");
      expect(withWindow("2026-12-28", "2027-01-04")?.result).toBe("fail");
    });

    it("states the days it counted and the minimum, so the result explains itself", () => {
      const reason = withWindow("2026-03-05", "2026-03-10")?.reason;

      expect(reason).toContain("5 วัน");
      expect(reason).toContain("ขั้นต่ำ 8 วัน");
    });

    it("does not judge a window it cannot measure, and says why", () => {
      expect(withWindow(null, "2026-03-19")).toMatchObject({ result: "not-evaluated", reason: expect.stringContaining("วันที่ประกาศ") });
      expect(withWindow("2026-03-05", null)).toMatchObject({ result: "not-evaluated", reason: expect.stringContaining("กำหนดยื่น") });
      expect(withWindow("2026-03-05", "2026-03-19", false)).toMatchObject({ result: "not-evaluated", reason: expect.stringContaining("ยังไม่ได้รับการยืนยัน") });
      expect(withWindow("2026-03-05", "not-a-date")?.result).toBe("not-evaluated");
    });

    it("does not judge a deadline that falls before the announcement: that is a misread date", () => {
      expect(withWindow("2026-03-05", "2026-02-05")?.result).toBe("not-evaluated");
    });

    it("does not read an impossible date as the day it rolls over to", () => {
      expect(withWindow("2026-03-05", "2026-02-30")?.result).toBe("not-evaluated");
      expect(withWindow("2026-03-05", "2026-03-19T00:00:00Z")?.result).toBe("not-evaluated");
    });

    it("follows the configured minimum", () => {
      const strict = { ...healthy, thresholds: { ...healthy.thresholds, minBidWindowDays: 30 } };

      expect(resultOf(strict, "C2")?.result).toBe("fail");
    });
  });

  describe("C3, the scope", () => {
    const withScope = (scope: Partial<ChecklistInput["scope"]>) => resultOf({ ...healthy, scope: { ...healthy.scope, ...scope } }, "C3");
    const text = (length: number) => "ก".repeat(length);

    it("passes a scope at both minimums and fails one short on either", () => {
      expect(withScope({ summary: { value: text(112), verified: true }, items: { value: 6, verified: true } })?.result).toBe("pass");
      expect(withScope({ summary: { value: text(111), verified: true } })?.result).toBe("fail");
      expect(withScope({ items: { value: 5, verified: true } })?.result).toBe("fail");
    });

    it("counts Thai characters, not UTF-16 units or bytes", () => {
      // 112 Thai letters are 112 characters; a length in bytes would be 336.
      expect(withScope({ summary: { value: text(112), verified: true }, items: { value: null, verified: false } })?.result).toBe("pass");
    });

    it("judges on length alone when the extraction found no count (older records), and says so", () => {
      const check = withScope({ items: { value: null, verified: false } });

      expect(check?.result).toBe("pass");
      expect(check?.reason).toContain("ไม่มีจำนวนรายการ");
    });

    it("does not use a count the pipeline has not confirmed", () => {
      expect(withScope({ items: { value: 1, verified: false } })?.result).toBe("pass");
    });

    it("does not judge a scope that is missing from what was read: not found is not vague", () => {
      expect(withScope({ location: "in_annex_not_provided" })?.result).toBe("not-evaluated");
      expect(withScope({ location: "none" })?.result).toBe("not-evaluated");
      expect(withScope({ summary: { value: null, verified: false } })?.result).toBe("not-evaluated");
      expect(withScope({ summary: { value: text(300), verified: false } })?.result).toBe("not-evaluated");
    });

    it("names which measure fell short", () => {
      expect(withScope({ summary: { value: text(10), verified: true } })?.reason).toContain("ด้านความยาว");
      expect(withScope({ items: { value: 1, verified: true } })?.reason).toContain("ด้านจำนวนรายการ");
      expect(withScope({ summary: { value: text(10), verified: true }, items: { value: 1, verified: true } })?.reason).toContain("ทั้งสองข้อ");
    });
  });

  it("fails C1 when no budget was extracted", () => {
    expect(resultOf({ ...healthy, budget: { value: null, verified: false } }, "C1")?.result).toBe("fail");
  });

  it("fails C1 when the budget is extracted but not verified", () => {
    expect(resultOf({ ...healthy, budget: { value: 1_500_000, verified: false } }, "C1")?.result).toBe("fail");
  });

  it("fails C1 for a budget outside the range the system accepts, including zero", () => {
    expect(resultOf({ ...healthy, budget: { value: 0, verified: true } }, "C1")?.result).toBe("fail");
    expect(resultOf({ ...healthy, budget: { value: 5_000, verified: true } }, "C1")?.result).toBe("fail");
  });

  it("keeps C1's reason free of the number, which the fields section already shows", () => {
    expect(resultOf(healthy, "C1")?.reason).not.toMatch(/\d/);
  });

  it("fails C4 when no qualification maps onto the taxonomy", () => {
    expect(resultOf({ ...healthy, qualificationTags: [] }, "C4")?.result).toBe("fail");
  });

  it("fails C4 when the qualifications are mapped but not verified", () => {
    expect(resultOf({ ...healthy, qualificationsVerified: false }, "C4")?.result).toBe("fail");
  });

  it("fails C5 on a statistical anomaly, using only the approved wording", () => {
    const c5 = resultOf({ ...healthy, verdict: { kind: "anomaly", side: "high", distance: 2 } }, "C5");

    expect(c5?.result).toBe("fail");
    expect(c5?.reason).toContain("statistical anomaly");
  });

  it("passes C5 when the peer group is too small to judge", () => {
    const verdict = { kind: "not-evaluated" as const, reason: "insufficient-peers" as const, n: 3 };

    expect(resultOf({ ...healthy, verdict }, "C5")?.result).toBe("pass");
  });

  it("leaves C5 not evaluated for any other reason, and says which reason", () => {
    const verdict = { kind: "not-evaluated" as const, reason: "unverified-category" as const, n: 0 };
    const c5 = resultOf({ ...healthy, verdict }, "C5");

    expect(c5?.result).toBe("not-evaluated");
    expect(c5?.reason).toContain("หมวดหมู่ยังไม่ได้รับการยืนยัน");
  });

  it("counts only evaluated checks in the score", () => {
    const checklist = evaluateChecklist({
      ...healthy,
      budget: { value: null, verified: false },
      verdict: { kind: "anomaly", side: "low", distance: 1 },
    });

    expect(checklist).toMatchObject({ passed: 3, evaluated: 5 });
  });
});

describe("checklistFieldsOf", () => {
  const field = <T,>(value: T, verified = true) => ({ raw: String(value), value, confidence: 0.9, verified });

  it("counts the announcement as its calendar day in the given zone, not its UTC day", () => {
    // 17:00 UTC on the 4th is already the 5th in Bangkok.
    const fields = checklistFieldsOf({ announcedAt: new Date("2026-03-04T17:00:00Z"), fields: {} }, "Asia/Bangkok");

    expect(fields.bidWindow.announcedOn).toBe("2026-03-05");
    expect(checklistFieldsOf({ announcedAt: new Date("2026-03-04T17:00:00Z"), fields: {} }, "UTC").bidWindow.announcedOn).toBe("2026-03-04");
  });

  it("accepts the announcement as the ISO string the detail route holds, and has none for a missing or invalid one", () => {
    expect(checklistFieldsOf({ announcedAt: "2026-03-05T00:00:00.000Z", fields: {} }, "Asia/Bangkok").bidWindow.announcedOn).toBe("2026-03-05");
    expect(checklistFieldsOf({ announcedAt: null, fields: {} }, "Asia/Bangkok").bidWindow.announcedOn).toBeNull();
    expect(checklistFieldsOf({ announcedAt: "garbage", fields: {} }, "Asia/Bangkok").bidWindow.announcedOn).toBeNull();
  });

  it("uses the scope location only once it is confirmed, so a doubtful reading cannot switch C3 off", () => {
    const record = (verified: boolean) => ({ announcedAt: null, fields: { scopeLocation: field("none" as const, verified) } });

    expect(checklistFieldsOf(record(false), "Asia/Bangkok").scope.location).toBeNull();
    expect(checklistFieldsOf(record(true), "Asia/Bangkok").scope.location).toBe("none");
  });

  it("carries a missing field as null and unconfirmed", () => {
    expect(checklistFieldsOf({ announcedAt: null, fields: {} }, "Asia/Bangkok")).toEqual({
      bidWindow: { announcedOn: null, deadline: { value: null, verified: false } },
      scope: { summary: { value: null, verified: false }, items: { value: null, verified: false }, location: null },
    });
  });
});

describe("summariseChecklists", () => {
  const plotted = (id: string, budget: number, checklist: ReturnType<typeof evaluateChecklist>, flagged = false) =>
    ({ id, title: `TOR ${id}`, budget, checklist, flagged });

  it("counts each check's failures and what it could not evaluate", () => {
    const summary = summariseChecklists([
      plotted("a", 1, evaluateChecklist({ ...healthy, qualificationTags: [] })),
      plotted("b", 2, evaluateChecklist(healthy)),
    ]);

    expect(summary.tors).toBe(2);
    expect(summary.byCheck.map(({ id, failed, notEvaluated }) => [id, failed, notEvaluated])).toEqual([
      ["C1", 0, 0],
      ["C2", 0, 0],
      ["C3", 0, 0],
      ["C4", 1, 0],
      ["C5", 0, 0],
    ]);
    expect(summary.byCheck[0]?.label).toBe(evaluateChecklist(healthy).checks[0]?.label);
  });

  it("lists every flagged budget, largest first, with the checks it failed besides the flag itself", () => {
    const anomaly = { kind: "anomaly", side: "high", distance: 2 } as const;
    const summary = summariseChecklists([
      plotted("small", 5_000_000, evaluateChecklist({ ...healthy, verdict: anomaly }), true),
      plotted("large", 90_000_000, evaluateChecklist({ ...healthy, qualificationTags: [], verdict: anomaly }), true),
      plotted("normal", 1_000_000, evaluateChecklist({ ...healthy, qualificationTags: [] })),
    ]);

    expect(summary.flagged.map(({ id, failed }) => [id, failed.map((check) => check.id)])).toEqual([
      ["large", ["C4"]],
      ["small", []],
    ]);
    expect(summary.flagged[0]).toMatchObject({ title: "TOR large", budget: 90_000_000 });
  });

  it("reports nothing when nothing is plotted", () => {
    expect(summariseChecklists([])).toEqual({ tors: 0, byCheck: [], flagged: [] });
  });
});
