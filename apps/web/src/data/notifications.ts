/**
 * Shared notification sample data for the header bell dropdown and the
 * Notifications screen, ported from mockups/TOR Radar App.dc.html (the
 * `notifs` array and the notifications-tab branch of `renderVals()`).
 * Figures/timestamps are placeholder sample data (FR-E-6 applies). Each
 * entry's `torSlug` points into ../data/tor-samples so both surfaces can link
 * straight to the matching TOR.
 */

export type NotificationKind = "match" | "deadline" | "anomaly";

export type HeaderNotification = {
  id: string;
  title: string;
  meta: string;
  kind: NotificationKind;
  torSlug: string;
};

/**
 * The bell dropdown's short list. Its copy is its own paraphrase (not the
 * TOR's own title), matching the mockup's `notifs` array exactly — kept as
 * its own literal list rather than derived from ALL_NOTIFICATIONS below.
 */
export const HEADER_NOTIFICATIONS: HeaderNotification[] = [
  {
    id: "match-gis",
    title: "จ้างพัฒนาระบบ GIS เพื่อบริหารจัดการน้ำท่วม",
    meta: "กรมชลประทาน · MATCH 92% · 2 ชม.",
    kind: "match",
    torSlug: "TOR-2569-0812-041",
  },
  {
    id: "match-smart-city",
    title: "จ้างพัฒนาแอปพลิเคชันรายงานปัญหาเมือง",
    meta: "เมืองพัทยา · MATCH 78% · 1 วัน",
    kind: "match",
    torSlug: "TOR-2569-0810-029",
  },
  {
    id: "deadline-chiangmai",
    title: "เตือน: TOR ที่บุ๊กมาร์กปิดรับใน 3 วัน",
    meta: "เทศบาลนครเชียงใหม่ · 19 ส.ค. 2569",
    kind: "deadline",
    torSlug: "TOR-2569-0811-038",
  },
];

export type ListedNotification = {
  id: string;
  kind: NotificationKind;
  tag: string;
  title: string;
  meta: string;
  time: string;
  /** Initial unread state, matching the mockup's hard-coded `unread` flags. */
  unread: boolean;
  torSlug: string;
};

/**
 * The full Notifications screen list — matches the mockup's `items` array
 * inside the notifications-tab branch of `renderVals()`.
 */
export const ALL_NOTIFICATIONS: ListedNotification[] = [
  {
    id: "match-gis",
    kind: "match",
    tag: "MATCH 92%",
    title: "จ้างพัฒนาระบบสารสนเทศภูมิศาสตร์ (GIS) เพื่อบริหารจัดการน้ำท่วม",
    meta: "กรมชลประทาน · ฿4,850,000 · ยื่นภายใน 25 ส.ค. 2569",
    time: "2 ชม.",
    unread: true,
    torSlug: "TOR-2569-0812-041",
  },
  {
    id: "match-smart-city",
    kind: "match",
    tag: "MATCH 78%",
    title: "จ้างพัฒนาแอปพลิเคชันรายงานปัญหาเมือง (Smart City Integration)",
    meta: "เมืองพัทยา · ฿2,300,000 · ยื่นภายใน 22 ส.ค. 2569",
    time: "1 วัน",
    unread: true,
    torSlug: "TOR-2569-0810-029",
  },
  {
    id: "deadline-chiangmai",
    kind: "deadline",
    tag: "เตือนหมดเขต",
    title: "TOR ที่บุ๊กมาร์กปิดรับใน 3 วัน",
    meta: "เทศบาลนครเชียงใหม่ · ปิดรับ 19 ส.ค. 2569",
    time: "1 วัน",
    unread: true,
    torSlug: "TOR-2569-0811-038",
  },
  {
    id: "anomaly-pollution",
    kind: "anomaly",
    tag: "ความผิดปกติทางสถิติ",
    title: "พบ TOR งบสูงกว่ากลุ่มเทียบ 3.1×IQR",
    meta: "กรมควบคุมมลพิษ · ฿9,400,000 · ไม่ใช่ข้อกล่าวหา",
    time: "3 วัน",
    unread: false,
    torSlug: "demo-anomaly",
  },
  {
    id: "match-cctv",
    kind: "match",
    tag: "MATCH 71%",
    title: "จ้างบำรุงรักษาระบบกล้อง CCTV ทางหลวงสายหลัก",
    meta: "กรมทางหลวง · ฿3,750,000 · ปิดรับแล้ว",
    time: "2 สัปดาห์",
    unread: false,
    torSlug: "TOR-2569-0722-004",
  },
];

export type NotificationTabKey = "all" | "unread" | NotificationKind;

export const NOTIFICATION_TABS: { key: NotificationTabKey; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "unread", label: "ยังไม่อ่าน" },
  { key: "match", label: "จับคู่ใหม่" },
  { key: "deadline", label: "ใกล้หมดเขต" },
  { key: "anomaly", label: "ความผิดปกติ" },
];
