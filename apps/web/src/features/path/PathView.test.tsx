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
