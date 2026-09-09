import { describe, expect, it } from "vitest";
import { formatThaiDate, matchSubject, renderMatchEmail, type MatchedTor } from "./match-email.template.js";

const NOW = new Date("2026-08-12T09:42:00+07:00");

function tor(over: Partial<MatchedTor> = {}): MatchedTor {
  return {
    reference: "TOR-2569-0812-041",
    title: "จ้างพัฒนาระบบสารสนเทศภูมิศาสตร์ (GIS) เพื่อบริหารจัดการน้ำท่วม",
    agency: "กรมชลประทาน",
    budgetThb: 4_850_000,
    deadline: new Date("2026-08-25T00:00:00+07:00"),
    matchPercent: 92,
    reasons: ["GIS / แผนที่ดิจิทัล", "พัฒนาเว็บแอปพลิเคชัน"],
    url: "https://torradar.th/tors/TOR-2569-0812-041",
    ...over,
  };
}

function render(tors: MatchedTor[]) {
  return renderMatchEmail({
    vendorName: "คุณนก",
    minMatchPercent: 70,
    tors,
    settingsUrl: "https://torradar.th/profile#notif-settings",
    unsubscribeUrl: "https://torradar.th/unsubscribe?t=abc",
    now: NOW,
  });
}

describe("match email", () => {
  it("names the count in the subject", () => {
    expect(matchSubject(2)).toBe("TOR ใหม่ 2 รายการตรงกับทักษะของคุณ");
    expect(render([tor(), tor()]).subject).toBe(matchSubject(2));
  });

  it("shows dates in Buddhist era, like every other surface", () => {
    expect(formatThaiDate(new Date("2026-08-25T00:00:00+07:00"))).toBe("25 ส.ค. 2569");
    expect(render([tor()]).html).toContain("25 ส.ค. 2569");
  });

  it("escapes extracted values — a TOR title is untrusted input", () => {
    // Titles come from AI extraction of a document this system did not write.
    const attack = '<img src=x onerror="alert(1)">';
    const { html } = render([tor({ title: attack, agency: attack })]);

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("marks a deadline inside a week as urgent, and one further out as not", () => {
    const soon = render([tor({ deadline: new Date("2026-08-16T00:00:00+07:00") })]).html;
    const later = render([tor({ deadline: new Date("2026-08-25T00:00:00+07:00") })]).html;

    expect(soon).toContain("เหลือ 4 วัน");
    expect(soon).toContain("#b45309"); // the amber the app uses for attention
    expect(later).toContain("เหลือ 13 วัน");
    expect(later).not.toContain("#b45309");
  });

  it("says so plainly when the announcement states no deadline or budget", () => {
    const { html, text } = render([tor({ deadline: null, budgetThb: null })]);

    expect(html).toContain("ไม่ระบุวันยื่นในประกาศ");
    expect(html).toContain("ไม่ระบุ");
    expect(text).toContain("ไม่ระบุงบประมาณ");
  });

  it("carries the AI label and the unsubscribe route (NFR-F6, PDPA)", () => {
    const { html, text } = render([tor()]);

    expect(html).toContain("ข้อมูลสกัดโดย AI จากประกาศสาธารณะ");
    expect(html).toContain("https://torradar.th/unsubscribe?t=abc");
    expect(html).toContain("https://torradar.th/profile#notif-settings");
    expect(text).toContain("ยกเลิกการรับอีเมล: https://torradar.th/unsubscribe?t=abc");
  });

  it("ships a plain-text part that stands on its own", () => {
    const { text } = render([tor(), tor({ reference: "TOR-2569-0810-029", matchPercent: 78 })]);

    // No markup, both records, and every link a reader would need.
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).toContain("TOR-2569-0812-041");
    expect(text).toContain("TOR-2569-0810-029");
    expect(text).toContain("https://torradar.th/tors/TOR-2569-0812-041");
  });

  it("keeps the score bar within the track", () => {
    const { html } = render([tor({ matchPercent: 92 })]);
    expect(html).toContain('width="92%"');
    expect(html).toContain('width="8%"');
  });

  it("stays inside what email clients render: no style block, no flexbox, no web font", () => {
    const { html } = render([tor()]);

    expect(html).not.toContain("<style");
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("fonts.googleapis.com");
    // Outlook drops colours it cannot parse, and a dropped colour on a dark band
    // is black on black.
    expect(html).not.toContain("rgba(");
  });
});
