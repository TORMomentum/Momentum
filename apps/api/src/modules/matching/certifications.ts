import { CERTIFICATIONS, type CertificationId } from "@tor-radar/seeds";
import type { TorDocument } from "../../core/db.js";

/**
 * How a TOR's qualification text names each listed certification. Read from
 * the corpus (2026-10-08, 223 TORs with qualifications): ISO 9001 in 23,
 * ISO 14001 in 11, มอก. in 12, SME in 2, วิศวกร and สถาปนิก in 1 each.
 */
const MENTIONS: Record<CertificationId, RegExp> = {
  "iso-9001": /ISO\s*9001/i,
  "iso-14001": /ISO\s*14001/i,
  "iso-45001": /ISO\s*45001|OHSAS\s*18001|มอก\.?\s*18001/i,
  tis: /มอก\.|มาตรฐานผลิตภัณฑ์อุตสาหกรรม/,
  sme: /\bSMEs?\b|สสว|วิสาหกิจขนาดกลางและขนาดย่อม/i,
  engineer: /ใบอนุญาตประกอบวิชาชีพวิศวกรรม|วิศวกรควบคุม|สภาวิศวกร/,
  architect: /ใบอนุญาตประกอบวิชาชีพสถาปัตยกรรม|สถาปนิก/,
};

const nameOf = new Map<string, string>(CERTIFICATIONS.map((item) => [item.id, item.th]));

export function qualificationText(record: Pick<TorDocument, "fields">): string {
  const value = record.fields.qualifications?.value;
  return Array.isArray(value) ? value.join("\n") : "";
}

/** The listed certifications a TOR's qualifications mention, by id. */
export function certificationsMentioned(text: string): CertificationId[] {
  return (Object.keys(MENTIONS) as CertificationId[]).filter((id) => MENTIONS[id].test(text));
}

export function certificationName(id: string): string {
  return nameOf.get(id) ?? id;
}
