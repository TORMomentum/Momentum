/**
 * What a vendor can hold that a TOR may require: the Comptroller General's
 * Department (กรมบัญชีกลาง) contractor registration, by branch, and the common
 * certifications Thai TORs ask for.
 *
 * The nine branches are the ones หนังสือ ว642 names: a construction project of
 * CGD_REGISTRATION_MIN_BUDGET_THB or more in one of them must be bid by a
 * contractor registered in that branch.
 */
export const CGD_BRANCHES = [
  { id: "road", th: "งานก่อสร้างทาง" },
  { id: "bridge", th: "งานก่อสร้างสะพาน" },
  { id: "special-road-bridge", th: "งานก่อสร้างทางและสะพานพิเศษ" },
  { id: "irrigation", th: "งานก่อสร้างชลประทาน" },
  { id: "bank-protection", th: "งานก่อสร้างเขื่อนป้องกันตลิ่งและชายฝั่ง" },
  { id: "marine", th: "งานก่อสร้างสิ่งปลูกสร้างในทะเล" },
  { id: "dredging-coastal", th: "งานก่อสร้างขุดลอกและบำรุงรักษาร่องน้ำชายฝั่งทะเล" },
  { id: "dredging-inland", th: "งานก่อสร้างขุดลอกและบำรุงรักษาร่องน้ำภายในประเทศ" },
  { id: "building", th: "งานก่อสร้างอาคาร" },
] as const;

export type CgdBranchId = (typeof CGD_BRANCHES)[number]["id"];

/** The registration classes, ชั้น 1 (largest) to ชั้น 5. Stored and shown; not yet used to rule on value. */
export const CGD_GRADES = [1, 2, 3, 4, 5] as const;

/** Certifications commonly stated as qualifications in Thai TORs. */
export const CERTIFICATIONS = [
  { id: "iso-9001", th: "ISO 9001 (ระบบบริหารคุณภาพ)" },
  { id: "iso-14001", th: "ISO 14001 (ระบบการจัดการสิ่งแวดล้อม)" },
  { id: "iso-45001", th: "ISO 45001 (อาชีวอนามัยและความปลอดภัย)" },
  { id: "tis", th: "มอก. (มาตรฐานผลิตภัณฑ์อุตสาหกรรม)" },
  { id: "sme", th: "ขึ้นทะเบียน SME (สสว.)" },
  { id: "engineer", th: "ใบอนุญาตวิศวกร (กว.)" },
  { id: "architect", th: "ใบอนุญาตสถาปนิก (กส.)" },
] as const;

export type CertificationId = (typeof CERTIFICATIONS)[number]["id"];

/**
 * The listed certifications a person holds rather than the company: licences to practise. ISO, มอก. and SME
 * are the company's, so staff are never recorded as holding them and never satisfy a TOR asking for them.
 */
export const PERSONAL_CERTIFICATION_IDS = ["engineer", "architect"] as const satisfies readonly CertificationId[];

/**
 * How a TOR's text names each listed certification. Read from the corpus (2026-10-08, 223 TORs with
 * qualifications): ISO 9001 in 23, ISO 14001 in 11, มอก. in 12, SME in 2, วิศวกร and สถาปนิก in 1 each.
 */
const MENTIONS: Record<CertificationId, RegExp> = {
  "iso-9001": /ISO\s*9001/i,
  "iso-14001": /ISO\s*14001/i,
  "iso-45001": /ISO\s*45001|OHSAS\s*18001|มอก\.?\s*18001/i,
  tis: /มอก\.|มาตรฐานผลิตภัณฑ์อุตสาหกรรม/,
  sme: /\bSMEs?\b|สสว|วิสาหกิจขนาดกลางและขนาดย่อม/i,
  // "ใบประกอบวิชาชีพ..." without "อนุญาต" is how required-document lists name it (6 of the 10 benchmark TORs).
  engineer: /ใบ(?:อนุญาต)?ประกอบวิชาชีพวิศวกรรม|วิศวกรควบคุม|สภาวิศวกร/,
  architect: /ใบอนุญาตประกอบวิชาชีพสถาปัตยกรรม|สถาปนิก/,
};

/** The listed certifications a piece of TOR text mentions, by id. */
export function certificationsMentioned(text: string): CertificationId[] {
  return (Object.keys(MENTIONS) as CertificationId[]).filter((id) => MENTIONS[id].test(text));
}
