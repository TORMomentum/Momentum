// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: "a" }));

import { MatchesPanel } from "./MatchesPanel";

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
    reasons: [{ code: "category", th: "ตรงกับหมวดหมู่งานที่คุณเลือก" }],
  };
}

describe("MatchesPanel", () => {
  it("shows each match with the same percentage search shows, and why it was picked", () => {
    act(() => root.render(<MatchesPanel matches={{ items: [match("a", 0.695)], reason: null }} />));
    // 0.695 rounds to 70, as the search badge rounds it.
    expect(container.textContent).toContain("70%");
    expect(container.textContent).toContain("ตรงกับหมวดหมู่งานที่คุณเลือก");
    expect(container.querySelector('a[href="/tors/a"]')).not.toBeNull();
  });

  it("shows five and sends the rest to search with the match filter on", () => {
    const items = Array.from({ length: 8 }, (_, i) => match(String(i), 0.9 - i * 0.05));
    act(() => root.render(<MatchesPanel matches={{ items, reason: null }} />));
    expect(container.querySelectorAll("li").length).toBe(5);
    expect(container.textContent).toContain("และอีก 3 รายการ");
    expect(container.querySelector('a[href="/search?minMatch=1&state=open"]')).not.toBeNull();
  });

  it("sends a vendor with no work chosen to their profile", () => {
    act(() => root.render(<MatchesPanel matches={{ items: [], reason: "กรุณาเลือกหมวดหมู่งานเพื่อดูรายการที่เกี่ยวข้อง" }} />));
    expect(container.textContent).toContain("กรุณาเลือกหมวดหมู่งาน");
    expect(container.querySelector('a[href="/profile"]')).not.toBeNull();
  });

  it("says the list failed to load instead of implying nothing fits", () => {
    act(() => root.render(<MatchesPanel matches={null} />));
    expect(container.textContent).toContain("ยังโหลดรายการที่เกี่ยวข้องไม่ได้");
  });
});
