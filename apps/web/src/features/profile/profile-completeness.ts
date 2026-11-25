import type { PastProject, PersonnelMember, VendorCertifications } from "../../shared/api/profile.api";

/**
 * How much of what matching reads the vendor has told it (design 2026-11-25-completeness-and-persona §2).
 *
 * Not "profile completeness": the optional items are never required to receive alerts (profile design §7.1), so
 * a missing one is named for what it would add, never as something wrong. Six items, each one the scorer reads,
 * weighted equally.
 */

export interface CompletenessInput {
  categories: string[];
  areas: string[];
  /** Null is a complete answer ("every budget"), so it always counts as answered. */
  budget: { minThb: number; maxThb: number } | null;
  pastProjects: PastProject[];
  /** Null = never stated. A stated "none" is an answer. */
  certifications: VendorCertifications | null;
  personnel: PersonnelMember[];
}

export interface CompletenessItem {
  key: "categories" | "areas" | "budget" | "pastProjects" | "certifications" | "personnel";
  label: string;
  /** What adding it does for matching, shown only while it is missing. */
  adds: string;
  /** The section on the profile page where it is set. */
  href: string;
  answered: boolean;
}

export interface Completeness {
  percent: number;
  items: CompletenessItem[];
  missing: CompletenessItem[];
}

const FIELDS = "#matching-fields";
const EXTRAS = "#matching-extras";

export function profileCompleteness(input: CompletenessInput): Completeness {
  const items: CompletenessItem[] = [
    { key: "categories", label: "หมวดหมู่งาน", adds: "ระบบจับคู่ TOR จากหมวดหมู่งานที่คุณรับทำ", href: FIELDS, answered: input.categories.length > 0 },
    { key: "areas", label: "พื้นที่ให้บริการ", adds: "ใช้คัด TOR ตามพื้นที่ที่คุณรับงาน", href: FIELDS, answered: input.areas.length > 0 },
    { key: "budget", label: "ช่วงงบประมาณ", adds: "ใช้ให้คะแนน TOR ตามขนาดงานที่คุณต้องการ", href: FIELDS, answered: true },
    { key: "pastProjects", label: "ผลงานที่ผ่านมา", adds: "ช่วยให้ TOR ที่คล้ายงานเดิมของคุณขึ้นก่อน", href: EXTRAS, answered: input.pastProjects.length > 0 },
    { key: "certifications", label: "ใบอนุญาตและการขึ้นทะเบียน", adds: "ระบบบอกได้ว่า TOR ใดขอใบอนุญาตที่คุณมีหรือยังไม่มี", href: EXTRAS, answered: input.certifications !== null },
    { key: "personnel", label: "บุคลากร", adds: "ระบบเทียบคุณวุฒิบุคลากรที่ TOR ระบุกับทีมของคุณ", href: EXTRAS, answered: input.personnel.length > 0 },
  ];
  const answered = items.filter((item) => item.answered).length;
  return {
    percent: Math.floor((answered / items.length) * 100),
    items,
    missing: items.filter((item) => !item.answered),
  };
}
