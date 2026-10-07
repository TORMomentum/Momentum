/**
 * The closed list of TOR categories (decided 2026-10-06; docs/superpowers/specs/2026-10-06-tor-category-list-design.md).
 *
 * Grouped by what a vendor sells or does, the way e-GP's own goods and works categories group
 * procurement, so each maps onto official codes (see the design note). One list for everything keyed
 * on a category: extraction chooses from it, grading only verifies a value on it, the admin picks
 * from it, and search facets and the anomaly rule's peer groups (the cohort category) group by it —
 * a CT scanner is compared with medical equipment, not with office chairs.
 */
export const TOR_CATEGORIES = [
  "ซื้อครุภัณฑ์การแพทย์และวิทยาศาสตร์",
  "ซื้อครุภัณฑ์สำนักงานและการศึกษา",
  "ซื้อคอมพิวเตอร์และอุปกรณ์ไอที",
  "ซื้อยานพาหนะ",
  "ซื้อวัสดุและครุภัณฑ์อื่น ๆ",
  "จ้างเหมาบริการ",
  "จ้างทำความสะอาดและรักษาความปลอดภัย",
  "จ้างที่ปรึกษาและออกแบบ",
  "งานก่อสร้าง-อาคาร",
  "งานก่อสร้าง-ทาง สะพาน",
  "งานก่อสร้าง-ชลประทานและระบบน้ำ",
  "งานก่อสร้าง-อื่น ๆ",
  "เช่า",
] as const;

export type TorCategory = (typeof TOR_CATEGORIES)[number];

export function isTorCategory(value: unknown): value is TorCategory {
  return typeof value === "string" && (TOR_CATEGORIES as readonly string[]).includes(value);
}

const MEDICAL = /การแพทย์|ทางแพทย์|เวชภัณฑ์|ซื้อยา|^ยา|ผู้ป่วย|เอกซเรย์|ทันตกรรม|วิทยาศาสตร์|ห้องปฏิบัติการ|ทารก|หัวใจ|หลอดเลือด|ตรวจวินิจฉัย|เครื่องช่วยหายใจ|ศัลยกรรม|ผ่าตัด|อวัยวะ|คลื่นเสียงความถี่สูง|อัลตราซาวด์|ultrasound|ไตเทียม|ฟอกไต|ชีวเคมี|ทางคลินิก|เภสัช|วัคซีน|กระดูก|ผิวหนัง|ออกซิเจน|ปั่นเหวี่ยง|สกัดสาร|ระเหยสาร|ตกตะกอน|น้ำบริสุทธิ์|สุญญากาศ|ห้องแล็บ/i;
const IT = /คอมพิวเตอร์|ซอฟต์แวร์|โปรแกรม|เครือข่าย|ระบบสารสนเทศ|เซิร์ฟเวอร์|server|เครื่องพิมพ์|ไอที|\bIT\b|ดิจิทัล|กล้องวงจรปิด|CCTV|ฮาร์ดแวร์|ดาวเทียม|วีดิทัศน์|Video Conference|อิเล็กทรอนิกส์|โครงข่าย|ใยแก้ว|ไฟเบอร์/i;
// Specific vehicles only: "รถเข็นผู้ป่วย" (a wheelchair) is medical equipment.
const VEHICLE = /รถ(ยนต์|บรรทุก|โดยสาร|พยาบาล|จักรยานยนต์|ขยะ|ดับเพลิง|กระเช้า|ตู้|กระบะ|บัส)|ยานพาหนะ|เรือ(?!น)|แทรกเตอร์/;
const OFFICE = /สำนักงาน|การศึกษา|การเรียนการสอน|โรงเรียน|นิสิต|นักศึกษา|โต๊ะ|เก้าอี้|ตู้|แบบเรียน|หนังสือ/;
const CLEANING_SECURITY = /ทำความสะอาด|รักษาความปลอดภัย|ต้นไม้|ภูมิทัศน์|สนามหญ้า|ขยะ|รักษาความสะอาด/;
const CONSULTING = /ที่ปรึกษา|ออกแบบ|ควบคุมงาน|ศึกษาความเหมาะสม|วิจัย/;
const BUILDING = /อาคาร|ห้อง|หอผู้ป่วย|โรงเรียน|สำนักงาน|โดม|หลังคา|ศาลา/;
const ROAD = /ทาง|ถนน|สะพาน|ท่อเหลี่ยม|ทางเท้า/;
const WATER = /ชลประทาน|ระบายน้ำ|คลอง|เขื่อน|ฝาย|ประปา|ท่อระบาย|บ่อบาดาล|ประตูระบายน้ำ|แหล่งน้ำ|ท่อส่งน้ำ|สถานีสูบน้ำ/;

/** What kind of procurement a text announces: buying, hiring, building, or renting. */
function kindOf(text: string): "buy" | "hire" | "build" | "rent" | null {
  const t = text.replace(/^(ประกวดราคา|ประกาศ|โครงการ|จัด|การ)+/, "");
  if (/^งานก่อสร้าง|^(จ้าง)?ก่อสร้าง|ก่อสร้าง/.test(t)) return "build";
  if (/^เช่า/.test(t)) return "rent";
  if (/^จ้าง/.test(t) && /(ปรับปรุง|ซ่อมแซม)/.test(t) && (BUILDING.test(t) || ROAD.test(t) || WATER.test(t))) return "build";
  if (/^จ้าง/.test(t)) return "hire";
  if (/^ซื้อ/.test(t)) return "buy";
  return null;
}

/** List values that only say the kind, which a title can make more specific. */
const GENERIC: ReadonlySet<string> = new Set(["จ้างเหมาบริการ", "ซื้อวัสดุและครุภัณฑ์อื่น ๆ", "งานก่อสร้าง-อื่น ๆ"]);

/** Construction by what is built: the category's own word first, the title's only if it has none. */
function buildingWork(category: string, title: string): TorCategory {
  for (const text of [category, title]) {
    if (BUILDING.test(text)) return "งานก่อสร้าง-อาคาร";
    if (WATER.test(text)) return "งานก่อสร้าง-ชลประทานและระบบน้ำ";
    if (ROAD.test(text)) return "งานก่อสร้าง-ทาง สะพาน";
  }
  return "งานก่อสร้าง-อื่น ๆ";
}

/**
 * The list's category for a free-text one — an earlier extraction, a model's answer, or the older
 * eleven-category list — or null when nothing says which. `context`, typically the TOR's title,
 * decides what is bought or built when the category alone does not ("ซื้อครุภัณฑ์" of what?).
 * A title's own opening word (ซื้อ / จ้าง / เช่า / ก่อสร้าง) outranks the category's: e-GP writes
 * it, while the category was a model's reading.
 */
export function normalizeCategory(text: unknown, context?: unknown): TorCategory | null {
  if (typeof text !== "string" && typeof context !== "string") return null;
  const category = typeof text === "string" ? text.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  // The procurement method in a title ("ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)") says nothing of
  // what is bought — and its "อิเล็กทรอนิกส์" would read as electronics — so it is cut first.
  const title =
    typeof context === "string"
      ? context.normalize("NFC").replace(/(โดย|ด้วย)วิธี.*$/, "").replace(/\s+/g, " ").trim()
      : "";
  // On the list already, and specific — or nothing to refine it with — it stands.
  if (isTorCategory(category) && (!GENERIC.has(category) || !title)) return category;
  const both = `${category} ${title}`;

  // "จ้าง" in a title also covers construction hires, so a category that says construction stands.
  const fromTitle = kindOf(title);
  const fromCategory = kindOf(category);
  const kind = fromTitle === "hire" && fromCategory === "build" ? "build" : (fromTitle ?? fromCategory);
  switch (kind) {
    case "build":
      return buildingWork(category, title);
    case "rent":
      return "เช่า";
    case "hire":
      if (CONSULTING.test(both)) return "จ้างที่ปรึกษาและออกแบบ";
      if (CLEANING_SECURITY.test(both)) return "จ้างทำความสะอาดและรักษาความปลอดภัย";
      return "จ้างเหมาบริการ";
    case "buy":
      if (VEHICLE.test(both)) return "ซื้อยานพาหนะ";
      if (MEDICAL.test(both)) return "ซื้อครุภัณฑ์การแพทย์และวิทยาศาสตร์";
      if (IT.test(both)) return "ซื้อคอมพิวเตอร์และอุปกรณ์ไอที";
      if (OFFICE.test(both)) return "ซื้อครุภัณฑ์สำนักงานและการศึกษา";
      return "ซื้อวัสดุและครุภัณฑ์อื่น ๆ";
    default:
      return isTorCategory(category) ? category : null;
  }
}
