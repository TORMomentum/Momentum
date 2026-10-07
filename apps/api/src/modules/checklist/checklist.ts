import type { Checklist, ChecklistCheck, ChecklistSummary } from "@tor-radar/shared";
import type { AnomalyVerdict } from "../stats/anomaly.rule.js";
import type { NotEvaluatedReason } from "../stats/eligibility.js";

export interface ChecklistInput {
  budget: { value: number | null; verified: boolean };
  budgetRange: { min: number; max: number };
  qualificationTags: string[];
  qualificationsVerified: boolean;
  verdict: AnomalyVerdict;
}

const NOT_EVALUATED_DEADLINE =
  "ยังไม่ประเมิน: เกณฑ์ระยะเวลายื่นข้อเสนอขั้นต่ำยังไม่ได้ปรับเทียบจากข้อมูลจริง";
const NOT_EVALUATED_SCOPE =
  "ยังไม่ประเมิน: เกณฑ์ความยาวและจำนวนหัวข้อของขอบเขตงานยังไม่ได้ปรับเทียบจากข้อมูลจริง";

const NOT_EVALUATED_REASON: Record<NotEvaluatedReason, string> = {
  "no-budget": "ไม่มีงบประมาณที่ใช้เปรียบเทียบได้",
  "unverified-budget": "งบประมาณยังไม่ได้รับการยืนยัน จึงยังไม่นำมาเปรียบเทียบ",
  "unverified-category": "หมวดหมู่ยังไม่ได้รับการยืนยัน จึงยังไม่นำมาจัดกลุ่มเปรียบเทียบ",
  "not-published": "TOR ยังไม่ได้เผยแพร่",
  restricted: "TOR ถูกจำกัดการเข้าถึง",
  "insufficient-peers": "กลุ่มเปรียบเทียบมีจำนวนไม่พอ",
  "stats-unavailable": "สถิติของกลุ่มเปรียบเทียบยังไม่พร้อมใช้งาน",
  "no-spread": "TOR ในกลุ่มเปรียบเทียบมีงบเท่ากันทั้งหมด จึงเทียบความผิดปกติไม่ได้",
};

function budgetStated(input: ChecklistInput): ChecklistCheck {
  const label = "งบประมาณระบุไว้";
  const { value, verified } = input.budget;
  const { min, max } = input.budgetRange;
  if (typeof value !== "number") {
    return { id: "C1", label, result: "fail", reason: "ไม่พบงบประมาณในเอกสาร" };
  }
  if (value < min || value > max) {
    return { id: "C1", label, result: "fail", reason: "งบประมาณอยู่นอกช่วงที่ระบบรับเปรียบเทียบได้" };
  }
  if (!verified) {
    return { id: "C1", label, result: "fail", reason: "งบประมาณยังไม่ได้รับการยืนยัน" };
  }
  return { id: "C1", label, result: "pass", reason: "ระบุงบประมาณและยืนยันแล้ว" };
}

function qualificationsStated(input: ChecklistInput): ChecklistCheck {
  const label = "ระบุคุณสมบัติผู้รับจ้าง";
  if (input.qualificationTags.length === 0) {
    return { id: "C4", label, result: "fail", reason: "ไม่พบคุณสมบัติที่จับคู่กับอนุกรมวิธานได้" };
  }
  if (!input.qualificationsVerified) {
    return { id: "C4", label, result: "fail", reason: "คุณสมบัติยังไม่ได้รับการยืนยัน" };
  }
  return { id: "C4", label, result: "pass", reason: `จับคู่คุณสมบัติกับอนุกรมวิธานได้ ${input.qualificationTags.length} รายการ` };
}

function budgetWithinPeerNorm(verdict: AnomalyVerdict): ChecklistCheck {
  const label = "งบประมาณอยู่ในช่วงปกติของกลุ่มเปรียบเทียบ";
  if (verdict.kind === "anomaly") {
    return {
      id: "C5",
      label,
      result: "fail",
      reason: "งบประมาณเป็น statistical anomaly เมื่อเทียบกับกลุ่มเปรียบเทียบ",
    };
  }
  if (verdict.kind === "normal") {
    return { id: "C5", label, result: "pass", reason: "งบประมาณอยู่ในช่วงปกติของกลุ่มเปรียบเทียบ" };
  }
  if (verdict.reason === "insufficient-peers") {
    return { id: "C5", label, result: "pass", reason: "กลุ่มเปรียบเทียบมีจำนวนไม่พอ จึงไม่ถือว่าผิดปกติ" };
  }
  return {
    id: "C5",
    label,
    result: "not-evaluated",
    reason: `ยังไม่ประเมินการเปรียบเทียบงบประมาณ: ${NOT_EVALUATED_REASON[verdict.reason]}`,
  };
}

/** SRS §4.6.1. Pure: the caller supplies the record's fields and its anomaly verdict. */
export function evaluateChecklist(input: ChecklistInput): Checklist {
  const checks: ChecklistCheck[] = [
    budgetStated(input),
    { id: "C2", label: "ระยะเวลายื่นข้อเสนอเพียงพอ", result: "not-evaluated", reason: NOT_EVALUATED_DEADLINE },
    { id: "C3", label: "ขอบเขตงานเจาะจง", result: "not-evaluated", reason: NOT_EVALUATED_SCOPE },
    qualificationsStated(input),
    budgetWithinPeerNorm(input.verdict),
  ];
  const evaluated = checks.filter((check) => check.result !== "not-evaluated");
  return {
    passed: evaluated.filter((check) => check.result === "pass").length,
    evaluated: evaluated.length,
    checks,
  };
}

/** One plotted TOR's checklist, with what the dashboard needs to name it when its budget is flagged. */
export interface PlottedChecklist {
  id: string;
  title: string | null;
  budget: number;
  checklist: Checklist;
  flagged: boolean;
}

/**
 * FR-F-4: per check, how many of the plotted TORs failed it or could not be evaluated on it, and every
 * flagged budget with the checks it failed. C5 is left out of a flagged TOR's list: failing it is what
 * the flag already says. Labels come from the results themselves, so the dashboard never states a
 * check differently from the TOR page.
 */
export function summariseChecklists(results: PlottedChecklist[]): ChecklistSummary {
  const byCheck = new Map<ChecklistCheck["id"], ChecklistSummary["byCheck"][number]>();
  for (const { checklist } of results) {
    for (const check of checklist.checks) {
      const row = byCheck.get(check.id) ?? { id: check.id, label: check.label, failed: 0, notEvaluated: 0 };
      if (check.result === "fail") row.failed += 1;
      else if (check.result === "not-evaluated") row.notEvaluated += 1;
      byCheck.set(check.id, row);
    }
  }
  const flagged = results
    .filter((result) => result.flagged)
    .sort((left, right) => right.budget - left.budget || left.id.localeCompare(right.id))
    .map(({ id, title, budget, checklist }) => ({
      id,
      title,
      budget,
      failed: checklist.checks
        .filter((check) => check.result === "fail" && check.id !== "C5")
        .map((check) => ({ id: check.id, label: check.label })),
    }));
  return { tors: results.length, byCheck: [...byCheck.values()], flagged };
}
