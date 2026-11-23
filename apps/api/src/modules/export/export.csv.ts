import type { Provenance } from "@tor-radar/shared";
import type { TorState } from "../../lib/tor-state.js";

/** Byte-order mark: without it Excel reads UTF-8 Thai as mojibake. */
export const CSV_BOM = "\uFEFF";

/**
 * Characters that make a spreadsheet read a cell as a formula (OWASP "CSV injection").
 * A value starting with one is prefixed with `'`, the only change made to any value
 * (spec 2026-11-23 decision 6).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One RFC 4180 field: quoted when it holds a comma, a quote or a line break. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: Array<string | number | null | undefined>): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

/** The fields of a list row the export reads; the list serializer's shape (`GET /tors`). */
interface ShownField<T> {
  raw?: string;
  value?: T | null;
  verified: boolean;
}

export interface ExportItem {
  id: string;
  announcedAt: string | Date | null;
  confidenceLevel: string | null;
  unverified: boolean;
  /** Still taking bids today, as the list decides it. */
  open: boolean;
  /** The badge's state, as the list decides it: a final stage from the source included (TOR-205). */
  torState: TorState;
  title?: ShownField<string>;
  referenceNo?: ShownField<string>;
  agency?: ShownField<string>;
  category?: ShownField<string>;
  budget?: ShownField<number>;
  deadline?: ShownField<string>;
  torStatus?: ShownField<string>;
}

/** What the export adds to a list row (`TorsService.exportDetailsFor`). */
export interface ExportDetails {
  provenance?: Provenance;
  /** The public page the record was collected from: the e-GP project, or the source URL. */
  source: string | null;
}

/** Thai headers (NFR-F7), in the order of spec §3 (revision §7). */
export const EXPORT_HEADER = [
  "เลขที่โครงการ",
  "ชื่อโครงการ",
  "หน่วยงาน",
  "หมวดหมู่",
  "หมวดหมู่ตามเอกสาร",
  "งบประมาณ (บาท)",
  "กำหนดยื่นข้อเสนอ",
  "กำหนดยื่นข้อเสนอตามเอกสาร",
  "สถานะ",
  "วันที่ประกาศ",
  "ระดับความมั่นใจ",
  "ยังไม่ยืนยันการสกัด",
  "ฟิลด์ที่ยังไม่ยืนยัน",
  "โมเดล AI ที่สกัด",
  "เวลาที่สกัด",
  "หน้า TOR",
  "เอกสารต้นฉบับ",
  "ประกาศต้นทาง",
] as const;

/** The exported fields, in Thai, as "ฟิลด์ที่ยังไม่ยืนยัน" names them. */
const CHECKED_FIELDS = [
  ["referenceNo", "เลขที่โครงการ"],
  ["title", "ชื่อโครงการ"],
  ["agency", "หน่วยงาน"],
  ["category", "หมวดหมู่"],
  ["budget", "งบประมาณ"],
  ["deadline", "กำหนดยื่นข้อเสนอ"],
  ["torStatus", "สถานะ"],
] as const;

const CONFIDENCE_LABELS: Record<string, string> = { high: "สูง", medium: "กลาง", low: "ต่ำ" };

/** The same five states, in the same words, as the status badge on /search. */
/** The five words of the `/search` badge, one per state of lib/tor-state.ts. */
const STATE_LABELS: Record<TorState, string> = {
  open: "เปิดรับข้อเสนอ",
  "awaiting-invitation": "รอประกาศเชิญชวน",
  closed: "ปิดรับแล้ว",
  awarded: "ประกาศผู้ชนะแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

export function stateLabel(item: Pick<ExportItem, "torState">): string {
  return STATE_LABELS[item.torState];
}

function isoDay(value: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function modelOf(provenance: Provenance | undefined): string {
  if (!provenance) return "";
  const { extractModel, modelVersion } = provenance;
  return modelVersion && modelVersion !== extractModel ? `${extractModel} (${modelVersion})` : extractModel;
}

/** One row: values as extracted (NFR-F7), with confidence, provenance and source links (NFR-F6). */
/**
 * What an empty text cell says (spec 2026-11-23-csv-export §8). "Not found", never "the document does not
 * state it": a document can state a value that extraction could not read.
 */
export const NOT_FOUND = "ไม่พบข้อมูล";
/** The deadline as written, when there is none yet because the invitation to bid is not out. */
export const NO_INVITATION_YET = "ยังไม่มีประกาศเชิญชวน";

/** A text value as extracted, or NOT_FOUND when there is none. Never re-worded otherwise (NFR-F7). */
export function orNotFound(text: string | null | undefined): string {
  return text && text.trim() !== "" ? text : NOT_FOUND;
}

/**
 * The deadline as the document words it. When there is no wording either, the state says why: a TOR whose
 * invitation to bid is not out has no deadline yet; anything else was not found. The ISO column beside it
 * stays empty instead, so Excel can still sort and filter it as dates.
 */
function deadlineAsWritten(item: Pick<ExportItem, "deadline" | "torState">): string {
  const raw = item.deadline?.raw;
  if (raw && raw.trim() !== "") return raw;
  return item.torState === "awaiting-invitation" ? NO_INVITATION_YET : NOT_FOUND;
}

export function exportRow(item: ExportItem, details: ExportDetails | undefined, appOrigin: string): Array<string | number | null> {
  const page = new URL(`/tors/${encodeURIComponent(item.id)}`, appOrigin).toString();
  const unverifiedFields = CHECKED_FIELDS.filter(([name]) => item[name] && !item[name]!.verified).map(([, label]) => label);
  // Text read from the TOR says NOT_FOUND when empty; numbers, dates, the record's own metadata and links
  // stay empty, so a spreadsheet can still sort, filter and follow them (spec §8).
  return [
    orNotFound(item.referenceNo?.raw),
    orNotFound(item.title?.raw),
    orNotFound(item.agency?.raw),
    orNotFound(item.category?.value),
    orNotFound(item.category?.raw),
    item.budget?.value ?? null,
    item.deadline?.value ?? "",
    deadlineAsWritten(item),
    stateLabel(item),
    isoDay(item.announcedAt),
    item.confidenceLevel ? (CONFIDENCE_LABELS[item.confidenceLevel] ?? item.confidenceLevel) : "",
    item.unverified ? "ใช่" : "ไม่",
    unverifiedFields.join("; "),
    modelOf(details?.provenance),
    details?.provenance?.extractedAt ?? "",
    page,
    `${page}/document`,
    details?.source ?? "",
  ];
}
