import type { Checklist, ChecklistCheck } from "@tor-radar/shared";
import type { AnomalyVerdict } from "../stats/anomaly.rule.js";

export interface ChecklistInput {
  budget: { value: number | null; verified: boolean };
  qualificationTags: string[];
  verdict: AnomalyVerdict;
}

const NOT_EVALUATED_DEADLINE =
  "ยังไม่ประเมิน: เกณฑ์ระยะเวลายื่นข้อเสนอขั้นต่ำยังไม่ได้ปรับเทียบจากข้อมูลจริง";
const NOT_EVALUATED_SCOPE =
  "ยังไม่ประเมิน: เกณฑ์ความยาวและจำนวนหัวข้อของขอบเขตงานยังไม่ได้ปรับเทียบจากข้อมูลจริง";

function budgetStated(budget: ChecklistInput["budget"]): ChecklistCheck {
  const label = "งบประมาณระบุไว้";
  if (typeof budget.value !== "number") {
    return { id: "C1", label, result: "fail", reason: "ไม่พบงบประมาณในเอกสาร" };
  }
  if (!budget.verified) {
    return { id: "C1", label, result: "fail", reason: "งบประมาณยังไม่ได้รับการยืนยัน" };
  }
  return {
    id: "C1",
    label,
    result: "pass",
    reason: `ระบุงบประมาณ ${budget.value.toLocaleString("en-US")} บาท และยืนยันแล้ว`,
  };
}

function qualificationsStated(tags: string[]): ChecklistCheck {
  const label = "ระบุคุณสมบัติผู้รับจ้าง";
  if (tags.length === 0) {
    return { id: "C4", label, result: "fail", reason: "ไม่พบคุณสมบัติที่จับคู่กับอนุกรมวิธานได้" };
  }
  return { id: "C4", label, result: "pass", reason: `จับคู่คุณสมบัติกับอนุกรมวิธานได้ ${tags.length} รายการ` };
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
  return { id: "C5", label, result: "not-evaluated", reason: "ยังไม่ประเมินการเปรียบเทียบงบประมาณ" };
}

/** SRS §4.6.1. Pure: the caller supplies the record's fields and its anomaly verdict. */
export function evaluateChecklist(input: ChecklistInput): Checklist {
  const checks: ChecklistCheck[] = [
    budgetStated(input.budget),
    { id: "C2", label: "ระยะเวลายื่นข้อเสนอเพียงพอ", result: "not-evaluated", reason: NOT_EVALUATED_DEADLINE },
    { id: "C3", label: "ขอบเขตงานเจาะจง", result: "not-evaluated", reason: NOT_EVALUATED_SCOPE },
    qualificationsStated(input.qualificationTags),
    budgetWithinPeerNorm(input.verdict),
  ];
  const evaluated = checks.filter((check) => check.result !== "not-evaluated");
  return {
    passed: evaluated.filter((check) => check.result === "pass").length,
    evaluated: evaluated.length,
    checks,
  };
}
