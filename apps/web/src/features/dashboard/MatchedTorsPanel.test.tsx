// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: "a" }));

import { MatchedTorsPanel } from "./MatchedTorsPanel";

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

function match(id: string, score: number) {
  return {
    id,
    title: `โครงการ ${id}`,
    agency: "กรุงเทพมหานคร",
    budget: { raw: "1000000", value: 1_000_000, verified: true },
    deadline: { raw: "2099-01-01", value: "2099-01-01", verified: true },
    unverified: false,
    score,
    reasons: [
      { code: "category", th: "ตรงกับหมวดหมู่งานที่คุณเลือก" },
      { code: "budget", th: "งบประมาณอยู่ในช่วงที่คุณระบุ" },
      { code: "extra", th: "เหตุผลที่สาม" },
    ],
  };
}

describe("MatchedTorsPanel", () => {
  it("lists the best matches with their score and why they matched", () => {
    act(() => root.render(<MatchedTorsPanel matches={{ items: [match("a", 0.72)], reason: null }} />));
    expect(container.textContent).toContain("TOR ที่ตรงกับคุณ");
    expect(container.textContent).toContain("72%");
    expect(container.textContent).toContain("ตรงกับหมวดหมู่งานที่คุณเลือก");
    // Two reasons say why; a third would crowd the row.
    expect(container.textContent).not.toContain("เหตุผลที่สาม");
    expect(container.querySelector('a[href="/tors/a"]')).not.toBeNull();
  });

  it("shows the budget, and the days left to bid, beside each match", () => {
    act(() => root.render(<MatchedTorsPanel matches={{ items: [match("a", 0.72)], reason: null }} />));
    expect(container.textContent).toContain("1,000,000");
    expect(container.textContent).toMatch(/เหลืออีก \d+ วัน/);
    // Only the kind-of-work reason is highlighted; budget stays a supporting line.
    const highlighted = [...container.querySelectorAll("li li")].filter((li) => li.className);
    expect(highlighted.map((li) => li.textContent)).toEqual(["ตรงกับหมวดหมู่งานที่คุณเลือก"]);
  });

  it("shows at most five and says how many more there are", () => {
    const items = Array.from({ length: 8 }, (_, i) => match(String(i), 0.9 - i * 0.05));
    act(() => root.render(<MatchedTorsPanel matches={{ items, reason: null }} />));
    expect(container.querySelectorAll("li > span").length).toBe(5);
    expect(container.textContent).toContain("และอีก 3 รายการ");
  });

  it("sends a vendor with no work chosen to their profile instead of showing nothing", () => {
    act(() =>
      root.render(
        <MatchedTorsPanel matches={{ items: [], reason: "กรุณาเลือกหมวดหมู่งานเพื่อดูรายการที่เกี่ยวข้อง" }} />,
      ),
    );
    expect(container.textContent).toContain("กรุณาเลือกหมวดหมู่งาน");
    expect(container.querySelector('a[href="/profile"]')).not.toBeNull();
  });

  it("says plainly when nothing matches right now", () => {
    act(() => root.render(<MatchedTorsPanel matches={{ items: [], reason: null }} />));
    expect(container.textContent).toContain("ยังไม่มี TOR ที่เปิดรับและตรงกับโปรไฟล์ของคุณ");
  });
});
