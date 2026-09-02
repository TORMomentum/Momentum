/**
 * Sample TOR corpus shared by the Search and TOR Detail screens, ported from
 * mockups/TOR Radar App.dc.html (the `data()` method of its Component class).
 * Figures are placeholders (FR-E-6 coverage note applies) — the real corpus
 * comes from the ingest pipeline, not from this file.
 */

export type QualCheck = {
  text: string;
  ok: boolean;
};

export type SpecCheck = {
  mark: "✓" | "△" | "◆";
  level: "ok" | "warn";
  text: string;
};

export type TorSample = {
  /** Route slug used under /tors/[id]. Matches the TOR id except for the one
   * entry the dashboard's anomaly plot point already links to as
   * "demo-anomaly" (apps/web/src/views/DashboardView.tsx). */
  slug: string;
  id: string;
  title: string;
  agency: string;
  cat: string;
  catKey: string;
  budget: number;
  posted: string;
  deadline: string;
  open: boolean;
  match: number | null;
  quality: string;
  conf: string;
  anomaly: boolean;
  unverified: boolean;
  scope: string;
  contact: string;
  docRef: string;
  priceNote: string;
  deadlineNote: string;
  extractedAt: string;
  quals: QualCheck[];
  checks: SpecCheck[];
};

/** Agencies the search sidebar filters by (a subset of the dashboard's list —
 * only the agencies represented in this sample corpus, as in the mockup). */
export const SEARCH_AGENCIES = [
  "กรมทางหลวง",
  "กรมชลประทาน",
  "เทศบาลนครเชียงใหม่",
  "เมืองพัทยา",
  "กรมควบคุมมลพิษ",
];

export const SEARCH_CATEGORIES = ["ก่อสร้าง", "ชลประทาน", "ไอที/ซอฟต์แวร์", "จ้างเหมาบริการ"];

export const BUDGET_FILTER_MIN = 500_000;
export const BUDGET_FILTER_MAX = 9_400_000;
export const BUDGET_FILTER_STEP = 100_000;

export const TOR_SAMPLES: TorSample[] = [
  {
    slug: "TOR-2569-0812-041",
    id: "TOR-2569-0812-041",
    title: "จ้างพัฒนาระบบสารสนเทศภูมิศาสตร์ (GIS) เพื่อบริหารจัดการน้ำท่วม",
    agency: "กรมชลประทาน",
    cat: "ไอที/ซอฟต์แวร์ · GIS",
    catKey: "ไอที/ซอฟต์แวร์",
    budget: 4_850_000,
    posted: "11 ส.ค. 2569",
    deadline: "25 ส.ค. 2569",
    open: true,
    match: 92,
    quality: "8.5",
    conf: "0.94",
    anomaly: false,
    unverified: false,
    scope:
      "พัฒนาระบบ GIS แสดงผลจุดเสี่ยงน้ำท่วมแบบเรียลไทม์ เชื่อมต่อข้อมูลเซ็นเซอร์ระดับน้ำ 380 จุด · จัดทำแดชบอร์ดผู้บริหารและ API สาธารณะ · อบรมเจ้าหน้าที่ 40 คน · ระยะเวลา 240 วัน",
    contact: "ฝ่ายพัสดุ กรมชลประทาน",
    docRef: "ประกาศกรมชลประทาน · 12 หน้า",
    priceNote: "ในช่วงปกติของกลุ่มเทียบ (GIS × Q3/2569)",
    deadlineNote: "เหลืออีก 13 วัน",
    extractedAt: "2026-08-11 14:03",
    quals: [
      { text: "GIS / แผนที่ดิจิทัล", ok: true },
      { text: "พัฒนาเว็บแอปพลิเคชัน", ok: true },
      { text: "ผลงานภาครัฐ ≥ 1 โครงการ", ok: true },
      { text: "ทุนจดทะเบียน ≥ ฿1M", ok: false },
    ],
    checks: [
      { mark: "✓", level: "ok", text: "ระบุงบประมาณชัดเจน (฿4,850,000)" },
      { mark: "✓", level: "ok", text: "กำหนดยื่นซอง 14 วัน ≥ เกณฑ์ขั้นต่ำ 7 วัน" },
      { mark: "✓", level: "ok", text: "ขอบเขตงานระบุ deliverable 6 รายการ, 240 วัน" },
      { mark: "✓", level: "ok", text: "งบอยู่ในช่วงปกติของกลุ่มเทียบ" },
      { mark: "△", level: "warn", text: "\"ทุนจดทะเบียน ≥ ฿1M\" ไม่มีเหตุผลประกอบ" },
    ],
  },
  {
    slug: "TOR-2569-0811-038",
    id: "TOR-2569-0811-038",
    title: "จ้างเหมาปรับปรุงเว็บไซต์และระบบจองคิวออนไลน์ เทศบาลนครเชียงใหม่",
    agency: "เทศบาลนครเชียงใหม่",
    cat: "ไอที/ซอฟต์แวร์",
    catKey: "ไอที/ซอฟต์แวร์",
    budget: 1_200_000,
    posted: "11 ส.ค. 2569",
    deadline: "19 ส.ค. 2569",
    open: true,
    match: null,
    quality: "6.0",
    conf: "0.58",
    anomaly: false,
    unverified: true,
    scope:
      "ปรับปรุงเว็บไซต์หลักและระบบจองคิวออนไลน์ · รองรับมือถือ · ย้ายข้อมูลจากระบบเดิม (สกัดจากภาพถ่ายเอกสาร — ตรวจสอบกับต้นฉบับ)",
    contact: "สำนักปลัดเทศบาล",
    docRef: "ประกาศเทศบาลนครเชียงใหม่ · สแกน 6 หน้า",
    priceNote: "ค่าจากเอกสารสแกน — ยังไม่ยืนยัน",
    deadlineNote: "เหลืออีก 7 วัน",
    extractedAt: "2026-08-11 14:03",
    quals: [
      { text: "พัฒนาเว็บแอปพลิเคชัน", ok: true },
      { text: "ระบบจองคิว/CRM", ok: false },
    ],
    checks: [
      { mark: "△", level: "warn", text: "สกัดจากภาพถ่าย — งบประมาณยังไม่ยืนยัน" },
      { mark: "✓", level: "ok", text: "กำหนดยื่นซองระบุชัดเจน" },
      { mark: "△", level: "warn", text: "ขอบเขตงานระบุกว้าง ไม่มี deliverable ชัดเจน" },
    ],
  },
  {
    slug: "TOR-2569-0810-029",
    id: "TOR-2569-0810-029",
    title: "จ้างพัฒนาแอปพลิเคชันรายงานปัญหาเมือง (Smart City Integration)",
    agency: "เมืองพัทยา",
    cat: "ไอที/ซอฟต์แวร์",
    catKey: "ไอที/ซอฟต์แวร์",
    budget: 2_300_000,
    posted: "10 ส.ค. 2569",
    deadline: "22 ส.ค. 2569",
    open: true,
    match: 78,
    quality: "9.0",
    conf: "0.96",
    anomaly: false,
    unverified: false,
    scope:
      "พัฒนาแอปมือถือรับแจ้งปัญหาเมือง เชื่อมระบบ Smart City เดิม · แดชบอร์ดติดตามสถานะ · SLA รายงานผล 72 ชม. · ระยะเวลา 180 วัน",
    contact: "สำนักยุทธศาสตร์ เมืองพัทยา",
    docRef: "ประกาศเมืองพัทยา · 15 หน้า",
    priceNote: "ในช่วงปกติของกลุ่มเทียบ",
    deadlineNote: "เหลืออีก 10 วัน",
    extractedAt: "2026-08-10 14:03",
    quals: [
      { text: "พัฒนาแอปมือถือ", ok: false },
      { text: "พัฒนาเว็บแอปพลิเคชัน", ok: true },
      { text: "API Integration", ok: true },
    ],
    checks: [
      { mark: "✓", level: "ok", text: "ระบุงบประมาณชัดเจน (฿2,300,000)" },
      { mark: "✓", level: "ok", text: "ขอบเขตงาน + SLA ชัดเจน" },
      { mark: "✓", level: "ok", text: "กำหนดยื่นซอง 12 วัน" },
    ],
  },
  {
    // The dashboard's flagged scatter point already links to /tors/demo-anomaly
    // (see DashboardView.tsx) — this is that TOR (mockup data index 3, id
    // TOR-2569-0808-017, budget ฿9.4M · 3.1×IQR, matching the dashboard tooltip).
    slug: "demo-anomaly",
    id: "TOR-2569-0808-017",
    title: "จ้างจัดทำระบบจัดเก็บเอกสารอิเล็กทรอนิกส์ พร้อมสแกนเอกสารย้อนหลัง",
    agency: "กรมควบคุมมลพิษ",
    cat: "ไอที/ซอฟต์แวร์",
    catKey: "ไอที/ซอฟต์แวร์",
    budget: 9_400_000,
    posted: "8 ส.ค. 2569",
    deadline: "18 ส.ค. 2569",
    open: true,
    match: null,
    quality: "4.5",
    conf: "0.91",
    anomaly: true,
    unverified: false,
    scope: "จัดทำระบบ e-Document พร้อมสแกนเอกสารย้อนหลัง 500,000 หน้า · ระยะเวลา 120 วัน",
    contact: "ฝ่ายพัสดุ กรมควบคุมมลพิษ",
    docRef: "ประกาศกรมควบคุมมลพิษ · 9 หน้า",
    priceNote: "สูงกว่ากลุ่มเทียบ 3.1×IQR — ความผิดปกติทางสถิติ",
    deadlineNote: "เหลืออีก 6 วัน",
    extractedAt: "2026-08-08 14:03",
    quals: [
      { text: "ระบบจัดการเอกสาร", ok: false },
      { text: "บริการสแกนเอกสาร", ok: false },
    ],
    checks: [
      { mark: "◆", level: "warn", text: "งบสูงกว่ากลุ่มเทียบ 3.1×IQR (กลุ่ม: e-Document × Q3/2569, n=14)" },
      { mark: "△", level: "warn", text: "กำหนดยื่นซอง 10 วัน ค่อนข้างสั้นเทียบขนาดงาน" },
      { mark: "△", level: "warn", text: "ไม่ระบุ spec ฮาร์ดแวร์สแกน" },
      { mark: "✓", level: "ok", text: "ระบุจำนวนหน้าเอกสารชัดเจน" },
    ],
  },
  {
    slug: "TOR-2569-0722-004",
    id: "TOR-2569-0722-004",
    title: "จ้างบำรุงรักษาระบบกล้อง CCTV ทางหลวงสายหลัก",
    agency: "กรมทางหลวง",
    cat: "จ้างเหมาบริการ",
    catKey: "จ้างเหมาบริการ",
    budget: 3_750_000,
    posted: "22 ก.ค. 2569",
    deadline: "5 ส.ค. 2569",
    open: false,
    match: null,
    quality: "7.5",
    conf: "0.95",
    anomaly: false,
    unverified: false,
    scope: "บำรุงรักษากล้อง CCTV 320 จุดตามทางหลวงสายหลัก · SLA ซ่อม 48 ชม. · ระยะเวลา 12 เดือน",
    contact: "ฝ่ายพัสดุ กรมทางหลวง",
    docRef: "ประกาศกรมทางหลวง · 10 หน้า",
    priceNote: "ในช่วงปกติของกลุ่มเทียบ",
    deadlineNote: "ปิดรับแล้ว",
    extractedAt: "2026-07-22 14:03",
    quals: [
      { text: "งานบำรุงรักษา CCTV", ok: false },
      { text: "ผลงานภาครัฐ ≥ 2 โครงการ", ok: false },
    ],
    checks: [
      { mark: "✓", level: "ok", text: "ระบุ SLA และจำนวนจุดชัดเจน" },
      { mark: "✓", level: "ok", text: "งบอยู่ในช่วงปกติ" },
    ],
  },
];

export function getTorBySlug(slug: string): TorSample | undefined {
  return TOR_SAMPLES.find((row) => row.slug === slug);
}

/** "฿4,850,000" style — matches the mockup's `'฿' + n.toLocaleString()`. */
export function formatBudgetFull(n: number): string {
  return "฿" + n.toLocaleString("en-US");
}

/** "฿4.9M" / "฿500K" style — matches the mockup's `fmtM()` slider label. */
export function formatBudgetShort(n: number): string {
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return "฿" + millions.toFixed(n % 1_000_000 ? 1 : 0) + "M";
  }
  return "฿" + Math.round(n / 1000) + "K";
}
