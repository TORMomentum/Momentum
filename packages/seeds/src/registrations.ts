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
