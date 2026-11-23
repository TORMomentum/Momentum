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
  title?: ShownField<string>;
  referenceNo?: ShownField<string>;
  agency?: ShownField<string>;
  category?: ShownField<string>;
  budget?: ShownField<number>;
  deadline?: ShownField<string>;
  torStatus?: ShownField<string>;
}

/** Thai headers (NFR-F7), in the order of spec §3. */
export const EXPORT_HEADER = [
  "รหัสระเบียน",
  "เลขที่โครงการ",
  "ชื่อโครงการ",
  "หน่วยงาน",
  "หมวดหมู่",
  "หมวดหมู่ตามเอกสาร",
  "งบประมาณ (บาท)",
  "งบประมาณตามเอกสาร",
  "กำหนดยื่นข้อเสนอ",
  "กำหนดยื่นข้อเสนอตามเอกสาร",
  "สถานะ",
  "วันที่ประกาศ",
  "ระดับความมั่นใจ",
  "ยังไม่ยืนยันการสกัด",
  "ฟิลด์ที่ยังไม่ยืนยัน",
  "โมเดลที่สกัด",
  "เวอร์ชันโมเดล",
  "เวลาที่สกัด",
  "หน้า TOR",
  "เอกสารต้นฉบับ",
] as const;

/** The exported fields, by the name a reader sees in "ฟิลด์ที่ยังไม่ยืนยัน". */
const CHECKED_FIELDS = ["referenceNo", "title", "agency", "category", "budget", "deadline", "torStatus"] as const;

function isoDay(value: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/** One row: values as extracted (NFR-F7), with confidence, provenance and source links (NFR-F6). */
export function exportRow(item: ExportItem, provenance: Provenance | undefined, appOrigin: string): Array<string | number | null> {
  const page = new URL(`/tors/${encodeURIComponent(item.id)}`, appOrigin).toString();
  const unverifiedFields = CHECKED_FIELDS.filter((name) => item[name] && !item[name]!.verified);
  return [
    item.id,
    item.referenceNo?.raw ?? "",
    item.title?.raw ?? "",
    item.agency?.raw ?? "",
    item.category?.value ?? "",
    item.category?.raw ?? "",
    item.budget?.value ?? null,
    item.budget?.raw ?? "",
    item.deadline?.value ?? "",
    item.deadline?.raw ?? "",
    item.torStatus?.value ?? "",
    isoDay(item.announcedAt),
    item.confidenceLevel ?? "",
    item.unverified ? "ใช่" : "ไม่",
    unverifiedFields.join(";"),
    provenance?.extractModel ?? "",
    provenance?.modelVersion ?? "",
    provenance?.extractedAt ?? "",
    page,
    `${page}/document`,
  ];
}
