import { describe, expect, it } from "vitest";
import { formatThaiDate, matchSubject, renderMatchEmail, renderStageEmail, stageSubject, type MatchedTor, type StageUpdate } from "./match-email.template.js";

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

  it("formats in Bangkok time, not the server's — a deadline must not shift a day", () => {
    // Midnight in Bangkok is 17:00 the previous day in UTC. Formatting with the
    // local-time getters printed the day before on any UTC host, which is CI
    // and every deployment. The vendor acts on this date.
    const bangkokMidnight = new Date("2026-08-25T00:00:00+07:00");
    expect(formatThaiDate(bangkokMidnight)).toBe("25 ส.ค. 2569");

    // Late evening in Bangkok is still the same Thai day, though already the
    // next day in UTC.
    const lateEvening = new Date("2026-08-25T23:30:00+07:00");
    expect(formatThaiDate(lateEvening)).toBe("25 ส.ค. 2569");
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

describe("stage note on a match (TOR-238)", () => {
  it("shows where the project stands in both parts, escaped, and nothing when no stage is known", () => {
    const withNote = render([tor({ stageNote: "ขั้นร่าง TOR · <ยังไม่เปิด>" })]);
    expect(withNote.html).toContain("ขั้นร่าง TOR · &lt;ยังไม่เปิด&gt;");
    expect(withNote.text).toContain("ขั้นร่าง TOR · <ยังไม่เปิด>");
    expect(render([tor()]).html).not.toContain("ขั้นร่าง TOR");
  });
});

describe("stage-change email (TOR-239)", () => {
  const update = (over: Partial<StageUpdate> = {}): StageUpdate => ({
    reference: "69109234234",
    title: "จ้างก่อสร้าง <script>อาคาร</script>",
    agency: "กรมชลประทาน",
    headline: "ประกาศเชิญชวนแล้ว",
    stageName: "ประกาศเชิญชวน",
    on: new Date("2026-08-14T12:00:00+07:00"),
    deadline: new Date("2026-08-25T12:00:00+07:00"),
    following: "matched",
    url: "https://torradar.th/tors/abc",
    ...over,
  });
  const renderStage = (over: Partial<StageUpdate> = {}) =>
    renderStageEmail({ vendorName: "คุณนก", update: update(over), settingsUrl: "https://torradar.th/profile", unsubscribeUrl: "https://torradar.th/profile", now: NOW });

  it("names the move in the subject and the stage as the source wrote it, with its day and the deadline", () => {
    const email = renderStage();
    expect(email.subject).toBe(stageSubject("ประกาศเชิญชวนแล้ว"));
    expect(email.text).toContain("ขั้นตอนล่าสุด: ประกาศเชิญชวน · 14 ส.ค. 2569");
    expect(email.text).toContain("ยื่นภายใน 25 ส.ค. 2569");
    expect(email.text).toContain("คุณได้รับแจ้งโครงการนี้เพราะตรงกับโปรไฟล์ของคุณ");
    expect(email.html).toContain("ดูขั้นตอนทั้งหมดของโครงการ");
    expect(email.html).toContain('href="https://torradar.th/profile"');
  });

  it("escapes what the source wrote, falls back to the headline for an unnamed stage, and says why a saver hears", () => {
    const email = renderStage({ stageName: null, deadline: null, following: "bookmarked", headline: "ประกาศผู้ชนะแล้ว" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.text).toContain("ขั้นตอนล่าสุด: ประกาศผู้ชนะแล้ว · 14 ส.ค. 2569");
    expect(email.text).not.toContain("ยื่นภายใน");
    expect(email.text).toContain("คุณบันทึกโครงการนี้ไว้");
  });
});
