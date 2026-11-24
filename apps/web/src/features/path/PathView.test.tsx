// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FieldPath } from "../../shared/api/path.api";
import { PathView } from "./PathView";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (target: string | null, result: FieldPath | null) => act(async () => root.render(<PathView target={target} result={result} />));
const result = (over: Partial<FieldPath> = {}): FieldPath => ({
  target: { id: "construction.road", th: "งานทาง สะพาน และท่อระบายน้ำ" },
  sample: 12,
  requirements: [
    { kind: "certification", id: "iso-9001", th: "ISO 9001", asked: 7, holds: false },
    { kind: "certification", id: "tis", th: "มอก.", asked: 3, holds: true },
    { kind: "registration", id: "road", th: "งานก่อสร้างทาง", asked: 2, holds: null },
  ],
  budget: { n: 10, medianThb: 3_000_000 },
  yourLargestProjectThb: null,
  ...over,
});

const spread = (over: Partial<NonNullable<FieldPath["winnerSpread"]>> = {}): NonNullable<FieldPath["winnerSpread"]> => ({
  topWinners: 3,
  minAwarded: 8,
  comparable: [
    { category: "งานก่อสร้าง-ทาง สะพาน", awarded: 32, winners: 27, topShare: 0.19 },
    { category: "งานก่อสร้าง-อาคาร", awarded: 14, winners: 11, topShare: 0.429 },
  ],
  notComparable: 2,
  ...over,
});

describe("PathView winner spread (TOR-284)", () => {
  it("lists the field's categories in the order the API gave, each with its counts and share", async () => {
    await render("construction", result({ winnerSpread: spread() }));
    const section = container.querySelector("[aria-labelledby='path-spread-title']")!;
    const rows = [...section.querySelectorAll("li")].map((row) => row.textContent);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("งานก่อสร้าง-ทาง สะพาน");
    expect(rows[0]).toContain("ประกาศผล 32 โครงการ · ผู้ชนะที่ต่างกัน 27 ราย");
    expect(rows[0]).toContain("ผู้ชนะ 3 รายแรกได้ 19%");
    expect(rows[1]).toContain("43%");
  });

  it("says what it covers, that bidders are not counted and that it is not a measure of difficulty, and how many categories are left out", async () => {
    await render("construction", result({ winnerSpread: spread() }));
    const text = container.querySelector("[aria-labelledby='path-spread-title']")!.textContent!;

    expect(text).toContain("AI อ่านและยืนยันแล้ว");
    expect(text).toContain("ไม่รวมจำนวนผู้ยื่นซอง");
    expect(text).toContain("ไม่ได้บอกว่าหมวดใดเข้าได้ง่ายหรือยาก");
    expect(text).toContain("อีก 2 หมวดยังมีประกาศผลไม่ถึง 8 โครงการ");
  });

  it("uses none of the forbidden wording and names no winner", async () => {
    await render("construction", result({ winnerSpread: spread() }));
    const text = container.querySelector("[aria-labelledby='path-spread-title']")!.textContent!;

    for (const word of ["น่าสงสัย", "ทุจริต", "ผิดปกติ", "suspicious", "บริษัท", "แข่งขันน้อย"]) expect(text).not.toContain(word);
  });

  it("says no category can be compared when none has enough announcements, and omits the section from an older API", async () => {
    await render("construction", result({ winnerSpread: spread({ comparable: [], notComparable: 4 }) }));
    expect(container.querySelector("[aria-labelledby='path-spread-title']")!.textContent).toContain("ยังไม่มีหมวดในสาขานี้ที่มีประกาศผู้ชนะถึง 8 โครงการ");

    await render("construction", result());
    expect(container.querySelector("[aria-labelledby='path-spread-title']")).toBeNull();
  });
});

describe("PathView", () => {
  it("offers every group and field in a plain GET form, so the choice lives in the URL", async () => {
    await render(null, null);
    const form = container.querySelector("form")!;
    expect(form.method).toBe("get");
    expect(container.querySelectorAll("select[name='target'] optgroup").length).toBeGreaterThan(1);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("shows how many TORs ask for each requirement and tells lacking, held and not-yet-stated apart", async () => {
    await render("construction.road", result());
    const rows = [...container.querySelectorAll("li")].map((row) => row.textContent);
    expect(rows[0]).toContain("7 จาก 12 TOR");
    expect(rows[0]).toContain("ยังไม่มีในโปรไฟล์");
    expect(rows[1]).toContain("คุณมีแล้ว");
    expect(rows[2]).toContain("ยังไม่ได้ระบุในโปรไฟล์");
    expect(container.textContent).toContain("ไม่ใช่เงื่อนไขของทุกโครงการ");
  });

  it("states the field's typical budget beside the vendor's largest project, or that they stated none", async () => {
    await render("construction.road", result());
    expect(container.textContent).toContain("฿3,000,000");
    expect(container.textContent).toContain("คุณยังไม่ได้ระบุมูลค่าผลงาน");
    await render("construction.road", result({ yourLargestProjectThb: 7_000_000 }));
    expect(container.textContent).toContain("ผลงานที่ใหญ่ที่สุดที่คุณระบุไว้ ฿7,000,000");
  });

  it("says so when there is nothing to summarise, and when the field could not be read", async () => {
    await render("construction.road", result({ sample: 0, requirements: [], budget: null }));
    expect(container.textContent).toContain("จึงยังสรุปไม่ได้");
    await render("construction.road", null);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("ไม่สำเร็จ");
  });
});
