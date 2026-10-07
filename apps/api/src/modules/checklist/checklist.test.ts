import { describe, expect, it } from "vitest";
import { evaluateChecklist, summariseChecklists, type ChecklistInput } from "./checklist.js";

const healthy: ChecklistInput = {
  budget: { value: 1_500_000, verified: true },
  budgetRange: { min: 10_000, max: 100_000_000_000 },
  qualificationTags: ["it-software"],
  qualificationsVerified: true,
  verdict: { kind: "normal" },
};

const resultOf = (input: ChecklistInput, id: string) =>
  evaluateChecklist(input).checks.find((check) => check.id === id);

describe("evaluateChecklist", () => {
  it("passes the evaluable checks and leaves C2 and C3 not evaluated", () => {
    const checklist = evaluateChecklist(healthy);

    expect(checklist.checks.map((check) => check.result)).toEqual([
      "pass",
      "not-evaluated",
      "not-evaluated",
      "pass",
      "pass",
    ]);
    expect(checklist).toMatchObject({ passed: 3, evaluated: 3 });
  });

  it("never claims C2 or C3 either way, whatever the record holds", () => {
    expect(resultOf({ ...healthy, budget: { value: null, verified: false } }, "C2")?.result).toBe("not-evaluated");
    expect(resultOf({ ...healthy, qualificationTags: [] }, "C3")?.result).toBe("not-evaluated");
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

    expect(checklist).toMatchObject({ passed: 1, evaluated: 3 });
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
      ["C2", 0, 2],
      ["C3", 0, 2],
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
