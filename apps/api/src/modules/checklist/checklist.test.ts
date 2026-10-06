import { describe, expect, it } from "vitest";
import { evaluateChecklist, type ChecklistInput } from "./checklist.js";

const healthy: ChecklistInput = {
  budget: { value: 1_500_000, verified: true },
  qualificationTags: ["it-software"],
  verdict: { kind: "normal" },
};

const resultOf = (input: ChecklistInput, id: string) =>
  evaluateChecklist(input).checks.find((check) => check.id === id)?.result;

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
    expect(resultOf({ ...healthy, budget: { value: null, verified: false } }, "C2")).toBe("not-evaluated");
    expect(resultOf({ ...healthy, qualificationTags: [] }, "C3")).toBe("not-evaluated");
  });

  it("fails C1 when no budget was extracted", () => {
    expect(resultOf({ ...healthy, budget: { value: null, verified: false } }, "C1")).toBe("fail");
  });

  it("fails C1 when the budget is extracted but not verified", () => {
    expect(resultOf({ ...healthy, budget: { value: 1_500_000, verified: false } }, "C1")).toBe("fail");
  });

  it("fails C4 when no qualification maps onto the taxonomy", () => {
    expect(resultOf({ ...healthy, qualificationTags: [] }, "C4")).toBe("fail");
  });

  it("fails C5 on a statistical anomaly, using only the approved wording", () => {
    const checklist = evaluateChecklist({ ...healthy, verdict: { kind: "anomaly", side: "high", distance: 2 } });
    const c5 = checklist.checks.find((check) => check.id === "C5");

    expect(c5?.result).toBe("fail");
    expect(c5?.reason).toContain("statistical anomaly");
  });

  it("passes C5 when the peer group is too small to judge", () => {
    const verdict = { kind: "not-evaluated" as const, reason: "insufficient-peers" as const, n: 3 };

    expect(resultOf({ ...healthy, verdict }, "C5")).toBe("pass");
  });

  it("leaves C5 not evaluated for any other reason, rather than passing it", () => {
    const verdict = { kind: "not-evaluated" as const, reason: "unverified-budget" as const, n: 0 };

    expect(resultOf({ ...healthy, verdict }, "C5")).toBe("not-evaluated");
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
