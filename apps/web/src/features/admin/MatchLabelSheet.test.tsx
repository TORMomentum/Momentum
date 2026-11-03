// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn());
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("./admin-accounts.actions", () => ({ saveMatchLabelAction: save }));

import type { MatchWorksheetItem } from "../../shared/lib/admin-api";
import { MatchLabelSheet } from "./MatchLabelSheet";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  save.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const item = (torId: string, matched: boolean, label: MatchWorksheetItem["label"] = null): MatchWorksheetItem => ({
  torId, title: `โครงการ ${torId}`, agency: "กทม.", score: matched ? 0.95 : 0.6, matched, reasons: ["ตรงกับหมวดงาน"], label,
});
const choice = (torId: string, text: string) =>
  [...container.querySelectorAll(`[aria-label="ตัดสิน โครงการ ${torId}"] button`)].find((b) => b.textContent === text) as HTMLButtonElement;

describe("MatchLabelSheet", () => {
  it("splits what email would send from what it would not, and counts progress", () => {
    act(() => root.render(<MatchLabelSheet accountId="v1" items={[item("a", true, "relevant"), item("b", false)]} />));
    const sections = [...container.querySelectorAll("section")];
    expect(sections[0]?.textContent).toContain("อีเมลจะส่ง");
    expect(sections[0]?.textContent).toContain("โครงการ a");
    expect(sections[1]?.textContent).toContain("โครงการ b");
    expect(container.textContent).toContain("ตรวจแล้ว 1 จาก 2 รายการ");
    expect(choice("a", "✓ เกี่ยวข้อง").getAttribute("aria-pressed")).toBe("true");
  });

  it("saves a judgement at once", async () => {
    save.mockResolvedValue({ ok: true });
    act(() => root.render(<MatchLabelSheet accountId="v1" items={[item("b", false)]} />));
    await act(async () => choice("b", "✗ ไม่เกี่ยวข้อง").click());
    expect(save).toHaveBeenCalledWith("v1", "b", "not-relevant");
    expect(choice("b", "✗ ไม่เกี่ยวข้อง").getAttribute("aria-pressed")).toBe("true");
  });

  it("puts the choice back and says why when the save is refused", async () => {
    save.mockResolvedValue({ ok: false, reason: "TOR นี้ไม่อยู่ในรายการของผู้ใช้นี้แล้ว — โหลดหน้าใหม่" });
    act(() => root.render(<MatchLabelSheet accountId="v1" items={[item("b", false)]} />));
    await act(async () => choice("b", "✓ เกี่ยวข้อง").click());
    expect(choice("b", "✓ เกี่ยวข้อง").getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("โหลดหน้าใหม่");
  });
});
