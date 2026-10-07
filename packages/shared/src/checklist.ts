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
