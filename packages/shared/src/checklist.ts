/** SRS §4.6.1. "not-evaluated" is an honest answer, never a pass or a fail. */
export type CheckResult = "pass" | "fail" | "not-evaluated";

export type CheckId = "C1" | "C2" | "C3" | "C4" | "C5";

export interface ChecklistCheck {
  id: CheckId;
  label: string;
  result: CheckResult;
  reason: string;
}

/** `passed` out of `evaluated`; a not-evaluated check counts toward neither. */
export interface Checklist {
  passed: number;
  evaluated: number;
  checks: ChecklistCheck[];
}

/**
 * FR-F-4: how the plotted TORs fared, check by check, and each budget flagged as a statistical
 * anomaly listed with the other checks it failed — so the two are read side by side.
 */
export interface ChecklistSummary {
  /** TORs the checklist ran on: every point the dashboard plots under the current filters. */
  tors: number;
  byCheck: Array<{ id: CheckId; label: string; failed: number; notEvaluated: number }>;
  /** The flagged budgets, largest first, each with the checks it failed besides C5 (the flag itself). */
  flagged: Array<{ id: string; title: string | null; budget: number; failed: Array<{ id: CheckId; label: string }> }>;
}
