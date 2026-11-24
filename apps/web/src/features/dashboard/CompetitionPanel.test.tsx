// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CompetitionPayload } from "../../shared/api/stats.api";
import { CompetitionPanel } from "./CompetitionPanel";

const payload = (over: Partial<CompetitionPayload> = {}): CompetitionPayload => ({
  categories: [
    { category: "ซื้อยานพาหนะ", awarded: 14, winners: 14, topShare: 0.214, eligible: true },
    { category: "งานก่อสร้าง-อาคาร", awarded: 14, winners: 11, topShare: 0.429, eligible: true },
    { category: "จ้างเหมาบริการ", awarded: 40, winners: 39, topShare: 0.1, eligible: true },
    { category: "ซื้อครุภัณฑ์สำนักงานและการศึกษา", awarded: 2, winners: 2, topShare: 1, eligible: false },
  ],
  rule: { topWinners: 3, minAwarded: 8 },
  meta: { awardedProjects: 70, lastAwardAt: "2026-11-23T21:33:18.735Z" },
  ...over,
});

const render = (value: CompetitionPayload) => renderToStaticMarkup(<CompetitionPanel competition={value} />);

describe("CompetitionPanel (TOR-281)", () => {
  it("lists comparable categories with their counts and the top winners' share, lowest share first", () => {
    const html = render(payload());

    expect(html).toContain("ผู้ชนะตามหมวดหมู่");
    expect(html).toContain("จากประกาศผู้ชนะ 70 โครงการ");
    expect(html).toContain("ทั้งระบบ ไม่เปลี่ยนตามตัวกรอง");
    expect(html).toContain("ผู้ชนะ 3 รายแรกได้");
    expect(html.indexOf("จ้างเหมาบริการ")).toBeLessThan(html.indexOf("ซื้อยานพาหนะ"));
    expect(html.indexOf("ซื้อยานพาหนะ")).toBeLessThan(html.indexOf("งานก่อสร้าง-อาคาร"));
    expect(html).toContain("10%");
    expect(html).toContain("21%");
    expect(html).toContain("43%");
  });

  it("keeps a category below the minimum sample out of the table and says why", () => {
    const html = render(payload());

    expect(html).not.toContain("<th scope=\"row\">ซื้อครุภัณฑ์สำนักงานและการศึกษา");
    expect(html).toContain("ยังเทียบไม่ได้ เพราะมีประกาศผลไม่ถึง 8 โครงการ: ซื้อครุภัณฑ์สำนักงานและการศึกษา (2)");
  });

  it("states what the figures cover, that they are not a judgment, and when the last announcement was read", () => {
    const html = render(payload());

    expect(html).toContain("ครอบคลุมเฉพาะโครงการที่ระบบรวบรวมได้");
    expect(html).toContain("AI อ่านและยืนยันแล้ว");
    expect(html).toContain("ไม่รวมจำนวนผู้ยื่นซอง");
    expect(html).toContain("ไม่ได้บอกว่าหมวดใดควรหรือไม่ควรเข้าแข่ง");
    expect(html).toContain("อ่านประกาศล่าสุด");
  });

  it("uses none of the forbidden wording (NFR-F5) and names no winner", () => {
    const html = render(payload());

    for (const word of ["น่าสงสัย", "ทุจริต", "ผิดปกติ", "suspicious", "corrupt", "irregular", "บริษัท"]) expect(html).not.toContain(word);
  });

  it("says no category can be compared yet when every one is below the minimum", () => {
    const html = render(payload({ categories: [{ category: "ยา", awarded: 3, winners: 3, topShare: 1, eligible: false }] }));

    expect(html).toContain("ยังไม่มีหมวดหมู่ที่มีประกาศผลถึง 8 โครงการ จึงยังเทียบกันไม่ได้");
    expect(html).not.toContain("<table");
  });

  it("renders nothing when no award has been read", () => {
    expect(render(payload({ categories: [], meta: { awardedProjects: 0, lastAwardAt: null } }))).toBe("");
  });
});
