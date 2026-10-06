/**
 * The work a vendor can say they do, and the only vocabulary matching uses.
 *
 * Two levels, deliberately. A free-text category cannot be matched against —
 * the live corpus contains "ประกาศเชิญชวนอิเล็กทรอนิกส์" as a category, which is
 * a procurement method, not work — and a deep tree cannot be filled in without
 * losing the vendor. A vendor picks a leaf or a whole group; a TOR classified to
 * a leaf still matches a vendor who chose its group, scoring lower than an exact
 * hit (profile and matching design §7.6).
 *
 * `unspsc` carries the Segment ("หมวดหลัก") of the United Nations Standard
 * Products and Services Code, which Thai e-GP classifies by. It is a crosswalk,
 * not the interface: records here come from published announcements rather than
 * e-GP's API, so a code is usually absent, and a group is never shown to a
 * vendor as a number.
 */

export interface WorkCategoryLeaf {
  /** Stable across renames: stored on profiles and matches, never the Thai label. */
  id: string;
  th: string;
  /** Words an announcement uses for this work, for the classifier's evidence. */
  synonyms: string[];
}

export interface WorkCategoryGroup {
  id: string;
  th: string;
  /** UNSPSC Segment this group crosswalks to, where one applies. */
  unspsc?: string;
  children: WorkCategoryLeaf[];
}

export const WORK_CATEGORIES: WorkCategoryGroup[] = [
  {
    id: "construction",
    th: "งานก่อสร้างและโยธา",
    unspsc: "72",
    children: [
      {
        id: "construction.road",
        th: "งานทาง สะพาน และระบายน้ำ",
        synonyms: ["ก่อสร้างถนน", "ปรับปรุงถนน", "ผิวจราจร", "ท่อระบายน้ำ", "สะพาน", "ทางเท้า", "คันหิน"],
      },
      {
        id: "construction.building",
        th: "อาคารและสิ่งปลูกสร้าง",
        synonyms: ["ก่อสร้างอาคาร", "ต่อเติมอาคาร", "ปรับปรุงอาคาร", "สิ่งปลูกสร้าง", "รั้ว"],
      },
      {
        id: "construction.repair",
        th: "ปรับปรุง ซ่อมแซม และบำรุงรักษาโครงสร้าง",
        synonyms: ["ซ่อมแซม", "บำรุงรักษาอาคาร", "ปรับปรุงภูมิทัศน์", "ซ่อมผิวทาง"],
      },
      {
        id: "construction.systems",
        th: "ระบบไฟฟ้า ประปา และเครื่องกลในอาคาร",
        synonyms: ["ระบบไฟฟ้า", "ระบบประปา", "ปรับอากาศ", "ลิฟต์", "ระบบดับเพลิง", "ไฟฟ้าแสงสว่าง"],
      },
      {
        id: "construction.landscape",
        th: "ภูมิทัศน์ สวนสาธารณะ และพื้นที่สีเขียว",
        synonyms: ["จัดสวน", "ภูมิทัศน์", "สวนสาธารณะ", "ปลูกต้นไม้", "สนามเด็กเล่น"],
      },
    ],
  },
  {
    id: "it",
    th: "เทคโนโลยีสารสนเทศ",
    unspsc: "43",
    children: [
      {
        id: "it.software",
        th: "พัฒนาซอฟต์แวร์และเว็บแอปพลิเคชัน",
        synonyms: ["พัฒนาระบบ", "เว็บไซต์", "แอปพลิเคชัน", "ซอฟต์แวร์", "โมบายแอป", "API"],
      },
      {
        id: "it.data",
        th: "ระบบสารสนเทศและฐานข้อมูล",
        synonyms: ["ฐานข้อมูล", "ระบบสารสนเทศ", "คลังข้อมูล", "วิเคราะห์ข้อมูล", "แดชบอร์ด"],
      },
      {
        id: "it.network",
        th: "เครือข่ายและโครงสร้างพื้นฐานไอที",
        synonyms: ["ระบบเครือข่าย", "เซิร์ฟเวอร์", "คลาวด์", "อินเทอร์เน็ต", "ศูนย์ข้อมูล"],
      },
      {
        id: "it.security",
        th: "ความปลอดภัยไซเบอร์",
        synonyms: ["ความมั่นคงปลอดภัยไซเบอร์", "ความปลอดภัยสารสนเทศ", "firewall", "ตรวจสอบช่องโหว่"],
      },
      {
        id: "it.gis",
        th: "ข้อมูลภูมิสารสนเทศและแผนที่ดิจิทัล",
        synonyms: ["ภูมิสารสนเทศ", "แผนที่", "GIS", "สำรวจพื้นที่", "ภาพถ่ายทางอากาศ"],
      },
    ],
  },
  {
    id: "goods",
    th: "ครุภัณฑ์และวัสดุ",
    unspsc: "44",
    children: [
      {
        id: "goods.office",
        th: "ครุภัณฑ์สำนักงาน",
        synonyms: ["ครุภัณฑ์สำนักงาน", "โต๊ะ", "เก้าอี้", "ตู้เอกสาร", "เครื่องใช้สำนักงาน"],
      },
      {
        id: "goods.computer",
        th: "ครุภัณฑ์คอมพิวเตอร์",
        synonyms: ["ครุภัณฑ์คอมพิวเตอร์", "คอมพิวเตอร์", "โน้ตบุ๊ก", "เครื่องพิมพ์", "จอภาพ"],
      },
      {
        id: "goods.medical",
        th: "ครุภัณฑ์การแพทย์และวิทยาศาสตร์",
        synonyms: ["ครุภัณฑ์การแพทย์", "เวชภัณฑ์", "เครื่องมือแพทย์", "ครุภัณฑ์วิทยาศาสตร์"],
      },
      {
        id: "goods.vehicle",
        th: "ยานพาหนะและเครื่องจักรกล",
        synonyms: ["ยานพาหนะ", "รถยนต์", "รถบรรทุก", "เครื่องจักรกล", "รถเก็บขยะ"],
      },
      {
        id: "goods.supplies",
        th: "วัสดุและอุปกรณ์ทั่วไป",
        synonyms: ["วัสดุสำนักงาน", "วัสดุก่อสร้าง", "วัสดุไฟฟ้า", "อุปกรณ์"],
      },
    ],
  },
  {
    id: "services",
    th: "จ้างเหมาบริการ",
    unspsc: "80",
    children: [
      {
        id: "services.security",
        th: "รักษาความปลอดภัย",
        synonyms: ["รักษาความปลอดภัย", "ยามรักษาการณ์", "รปภ."],
      },
      {
        id: "services.cleaning",
        th: "ทำความสะอาดและดูแลสถานที่",
        synonyms: ["ทำความสะอาด", "แม่บ้าน", "ดูแลสถานที่", "กำจัดขยะ", "ตัดหญ้า"],
      },
      {
        id: "services.maintenance",
        th: "ดูแลระบบและบำรุงรักษา",
        synonyms: ["บำรุงรักษา", "ดูแลระบบ", "ซ่อมบำรุง", "MA"],
      },
      {
        id: "services.logistics",
        th: "ขนส่งและโลจิสติกส์",
        synonyms: ["ขนส่ง", "ขนย้าย", "เช่ารถ", "โลจิสติกส์"],
      },
      {
        id: "services.catering",
        th: "อาหารและโภชนาการ",
        synonyms: ["อาหาร", "อาหารกลางวัน", "จัดเลี้ยง", "โภชนาการ"],
      },
    ],
  },
  {
    id: "professional",
    th: "งานที่ปรึกษาและออกแบบ",
    unspsc: "80",
    children: [
      {
        id: "professional.consulting",
        th: "ที่ปรึกษา ศึกษา และวิจัย",
        synonyms: ["ที่ปรึกษา", "ศึกษาความเหมาะสม", "วิจัย", "ประเมินผล", "จัดทำแผน"],
      },
      {
        id: "professional.design",
        th: "ออกแบบและควบคุมงานก่อสร้าง",
        synonyms: ["ออกแบบ", "ควบคุมงาน", "สถาปนิก", "วิศวกรที่ปรึกษา", "เขียนแบบ"],
      },
      {
        id: "professional.survey",
        th: "สำรวจและจัดทำแผนที่",
        synonyms: ["สำรวจ", "รังวัด", "จัดทำแผนที่", "สำรวจออกแบบ"],
      },
      {
        id: "professional.training",
        th: "ฝึกอบรมและพัฒนาบุคลากร",
        synonyms: ["ฝึกอบรม", "สัมมนา", "พัฒนาบุคลากร", "หลักสูตร"],
      },
    ],
  },
  {
    id: "communications",
    th: "สื่อสารและประชาสัมพันธ์",
    unspsc: "82",
    children: [
      {
        id: "communications.media",
        th: "ผลิตสื่อและสิ่งพิมพ์",
        synonyms: ["ผลิตสื่อ", "สิ่งพิมพ์", "วีดิทัศน์", "ออกแบบกราฟิก", "จัดพิมพ์"],
      },
      {
        id: "communications.events",
        th: "จัดงานและนิทรรศการ",
        synonyms: ["จัดงาน", "นิทรรศการ", "กิจกรรม", "เวที"],
      },
      {
        id: "communications.pr",
        th: "โฆษณาและประชาสัมพันธ์",
        synonyms: ["ประชาสัมพันธ์", "โฆษณา", "สื่อออนไลน์", "แคมเปญ"],
      },
    ],
  },
];

/**
 * Words that appear in a category field but describe HOW something is bought,
 * not WHAT is being bought. The live corpus holds "ประกาศเชิญชวนอิเล็กทรอนิกส์"
 * as a category; classifying it as work would be wrong in a way no score can
 * recover from, so it is rejected outright as a field-type error.
 */
export const NOT_A_CATEGORY: string[] = [
  "ประกวดราคาอิเล็กทรอนิกส์",
  "ประกวดราคา",
  "ประกาศเชิญชวน",
  "e-bidding",
  "สอบราคา",
  "วิธีเฉพาะเจาะจง",
  "วิธีคัดเลือก",
  "ตลาดอิเล็กทรอนิกส์",
  "e-market",
  "จัดซื้อจัดจ้าง",
  "ร่างขอบเขตของงาน",
  "TOR",
];

/** Every leaf, flattened — what a lookup by id reads. */
export const WORK_CATEGORY_LEAVES: ReadonlyArray<WorkCategoryLeaf & { groupId: string }> =
  WORK_CATEGORIES.flatMap((group) => group.children.map((leaf) => ({ ...leaf, groupId: group.id })));

/**
 * Bumped whenever a label, synonym or id changes. Stored beside every
 * classification so a match made under an older vocabulary can still be
 * explained, and so a reclassification is reproducible (design §7.5).
 */
export const TAXONOMY_VERSION = "2026-10-07";
