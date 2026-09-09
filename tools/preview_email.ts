/**
 * Renders the match email with sample data so it can be looked at.
 *
 *   npx tsx tools/preview_email.ts [outfile]
 *
 * Writes an HTML file and prints the path. Sample data only — this never
 * touches the database and never sends anything.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderMatchEmail } from "../apps/api/src/modules/notifications/match-email.template.js";

const now = new Date("2026-08-12T09:42:00+07:00");

const rendered = renderMatchEmail({
  vendorName: "คุณนก",
  minMatchPercent: 70,
  now,
  settingsUrl: "https://torradar.th/profile#notif-settings",
  unsubscribeUrl: "https://torradar.th/unsubscribe?t=sample",
  tors: [
    {
      reference: "TOR-2569-0812-041",
      title: "จ้างพัฒนาระบบสารสนเทศภูมิศาสตร์ (GIS) เพื่อบริหารจัดการน้ำท่วม",
      agency: "กรมชลประทาน",
      budgetThb: 4_850_000,
      deadline: new Date("2026-08-25T00:00:00+07:00"),
      matchPercent: 92,
      reasons: ["GIS / แผนที่ดิจิทัล", "พัฒนาเว็บแอปพลิเคชัน", "ผลงานภาครัฐ ≥ 1 โครงการ"],
      url: "https://torradar.th/tors/TOR-2569-0812-041",
    },
    {
      reference: "TOR-2569-0810-029",
      title: "จ้างพัฒนาแอปพลิเคชันรายงานปัญหาเมือง (Smart City Integration)",
      agency: "เมืองพัทยา",
      budgetThb: 2_300_000,
      deadline: new Date("2026-08-22T00:00:00+07:00"),
      matchPercent: 78,
      reasons: ["พัฒนาเว็บแอปพลิเคชัน", "API Integration"],
      url: "https://torradar.th/tors/TOR-2569-0810-029",
    },
  ],
});

const out = resolve(process.argv[2] ?? "email-preview.html");
writeFileSync(out, rendered.html, "utf8");
console.log(`subject: ${rendered.subject}`);
console.log(`html:    ${out}`);
console.log(`text:\n${rendered.text}`);
