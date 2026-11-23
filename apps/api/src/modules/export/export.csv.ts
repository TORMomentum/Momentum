import type { Provenance } from "@tor-radar/shared";

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
export function stateLabel(item: Pick<ExportItem, "open" | "deadline" | "torStatus">): string {
  if (item.torStatus?.value === "cancelled") return "ยกเลิกแล้ว";
  if (item.torStatus?.value === "awarded") return "ประกาศผู้ชนะแล้ว";
  if (!item.open) return "ปิดรับแล้ว";
  if (item.deadline?.value == null) return "รอประกาศเชิญชวน";
  return "เปิดรับข้อเสนอ";
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
export function exportRow(item: ExportItem, details: ExportDetails | undefined, appOrigin: string): Array<string | number | null> {
  const page = new URL(`/tors/${encodeURIComponent(item.id)}`, appOrigin).toString();
  const unverifiedFields = CHECKED_FIELDS.filter(([name]) => item[name] && !item[name]!.verified).map(([, label]) => label);
  return [
    item.referenceNo?.raw ?? "",
    item.title?.raw ?? "",
    item.agency?.raw ?? "",
    item.category?.value ?? "",
    item.category?.raw ?? "",
    item.budget?.value ?? null,
    item.deadline?.value ?? "",
    item.deadline?.raw ?? "",
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
