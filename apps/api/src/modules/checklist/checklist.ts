import type { Checklist, ChecklistCheck, ChecklistSummary, TorFields } from "@tor-radar/shared";
import { calendarDate } from "../../lib/calendar-date.js";
import type { AnomalyVerdict } from "../stats/anomaly.rule.js";
import type { NotEvaluatedReason } from "../stats/eligibility.js";

export interface ChecklistInput {
  budget: { value: number | null; verified: boolean };
  budgetRange: { min: number; max: number };
  /** C2: the announcement's calendar day and the bid deadline, both `YYYY-MM-DD`. */
  bidWindow: { announcedOn: string | null; deadline: { value: string | null; verified: boolean } };
  /** C3: what the extraction read of the scope. `items` is the count of concrete requirements. */
  scope: {
    summary: { value: string | null; verified: boolean };
    items: { value: number | null; verified: boolean };
    location: "in_documents" | "in_annex_not_provided" | "none" | null;
  };
  /** TOR-200: the calibrated minimums (Config.checklist). */
  thresholds: { minBidWindowDays: number; minScopeChars: number; minScopeSections: number };
  qualificationTags: string[];
  qualificationsVerified: boolean;
  verdict: AnomalyVerdict;
}

const DAY_MS = 86_400_000;

/**
 * The C2 and C3 inputs of a record, built in one place so the dashboard and the TOR page read the same fields.
 * The announcement is reduced to its calendar day in `timeZone`, the way the cohort month is, so a bid window
 * is counted in whole days however the announcement time was stored.
 */
export function checklistFieldsOf(
  record: { announcedAt: Date | string | null; fields: Partial<TorFields> },
  timeZone: string,
): Pick<ChecklistInput, "bidWindow" | "scope"> {
  const announced = record.announcedAt ? new Date(record.announcedAt) : null;
  const { deadline, scopeSummary, scopeItems, scopeLocation } = record.fields;
  return {
    bidWindow: {
      announcedOn: announced && !Number.isNaN(announced.getTime()) ? calendarDate(announced, timeZone) : null,
      deadline: { value: deadline?.value ?? null, verified: deadline?.verified ?? false },
    },
    scope: {
      summary: { value: scopeSummary?.value ?? null, verified: scopeSummary?.verified ?? false },
      items: { value: scopeItems?.value ?? null, verified: scopeItems?.verified ?? false },
      // Like the summary and the count, it counts only once confirmed: a doubtful "none" must not switch C3 off.
      location: scopeLocation?.verified ? (scopeLocation.value ?? null) : null,
    },
  };
}

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

/** Whole days from one `YYYY-MM-DD` to another; null when either is not a real calendar date. */
function daysBetween(from: string, to: string): number | null {
  const start = calendarDayMs(from);
  const end = calendarDayMs(to);
  return start === null || end === null ? null : Math.round((end - start) / DAY_MS);
}

/** UTC midnight of a `YYYY-MM-DD` that names a real day; null for anything else, so 2026-02-30 is not read as 2 March. */
function calendarDayMs(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== day ? null : at;
}

function bidWindowWorkable(input: ChecklistInput): ChecklistCheck {
  const label = "ระยะเวลายื่นข้อเสนอเพียงพอ";
  const { announcedOn, deadline } = input.bidWindow;
  const minimum = input.thresholds.minBidWindowDays;
  const notEvaluated = (reason: string): ChecklistCheck => ({ id: "C2", label, result: "not-evaluated", reason: `ยังไม่ประเมิน: ${reason}` });
  if (!announcedOn) return notEvaluated("ไม่พบวันที่ประกาศ จึงนับระยะเวลาไม่ได้");
  if (!deadline.value) return notEvaluated("ไม่พบกำหนดยื่นข้อเสนอในเอกสาร");
  // The same bar C1 and C4 set: a value the pipeline has not confirmed does not decide a result.
  if (!deadline.verified) return notEvaluated("กำหนดยื่นข้อเสนอยังไม่ได้รับการยืนยัน");
  const days = daysBetween(announcedOn, deadline.value);
  if (days === null) return notEvaluated("อ่านวันที่ไม่ได้");
  // A deadline before the announcement is far likelier a misread date than a real window, so it is not judged.
  if (days < 0) return notEvaluated("กำหนดยื่นข้อเสนออยู่ก่อนวันที่ประกาศ ควรตรวจเอกสารต้นฉบับ");
  return days >= minimum
    ? { id: "C2", label, result: "pass", reason: `ระยะเวลา ${days} วันนับจากวันที่ประกาศ (ขั้นต่ำ ${minimum} วัน)` }
    : { id: "C2", label, result: "fail", reason: `ระยะเวลา ${days} วันนับจากวันที่ประกาศ น้อยกว่าขั้นต่ำ ${minimum} วัน` };
}

/**
 * C3 reads two measures of the scope the extraction produced: the length of its summary and the number of
 * concrete requirements it lists. Each counts only when the pipeline confirmed it, and the count only when
 * the extraction found one (older records have none). A scope that is not in the documents read, or has
 * nothing to measure, is not judged: "not found" is never taken as "vague".
 */
function scopeSpecific(input: ChecklistInput): ChecklistCheck {
  const label = "ขอบเขตงานเจาะจง";
  const { summary, items, location } = input.scope;
  const { minScopeChars, minScopeSections } = input.thresholds;
  const notEvaluated = (reason: string): ChecklistCheck => ({ id: "C3", label, result: "not-evaluated", reason: `ยังไม่ประเมิน: ${reason}` });
  if (location === "in_annex_not_provided") return notEvaluated("ขอบเขตงานอยู่ในเอกสารแนบที่ไม่ได้รับมา");
  if (location === "none") return notEvaluated("ไม่พบขอบเขตงานในเอกสาร");
  if (!summary.verified || summary.value === null) return notEvaluated("สรุปขอบเขตงานยังไม่ได้รับการยืนยัน");

  const chars = [...summary.value.trim()].length;
  const counted = items.verified && typeof items.value === "number" ? items.value : null;
  const short = chars < minScopeChars;
  const fewItems = counted !== null && counted < minScopeSections;
  const stated = `สรุปขอบเขต ${chars} อักขระ (ขั้นต่ำ ${minScopeChars})${counted === null ? "" : ` · ${counted} รายการ (ขั้นต่ำ ${minScopeSections})`}`;
  if (short || fewItems) {
    return { id: "C3", label, result: "fail", reason: `${stated} ต่ำกว่าเกณฑ์${short && fewItems ? "ทั้งสองข้อ" : short ? "ด้านความยาว" : "ด้านจำนวนรายการ"}` };
  }
  return { id: "C3", label, result: "pass", reason: `${stated}${counted === null ? " · ไม่มีจำนวนรายการให้เทียบ" : ""}` };
}

/** SRS §4.6.1. Pure: the caller supplies the record's fields and its anomaly verdict. */
export function evaluateChecklist(input: ChecklistInput): Checklist {
  const checks: ChecklistCheck[] = [
    budgetStated(input),
    bidWindowWorkable(input),
    scopeSpecific(input),
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
