// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bulk = vi.hoisted(() => vi.fn());
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("./admin.actions", () => ({ bulkTorsAction: bulk }));

import { AdminTorsTable, type AdminTorsTableRow } from "./AdminTorsTable";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom has no <dialog> methods; the confirm dialog calls them.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  bulk.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const row = (id: string): AdminTorsTableRow => ({ id, title: `โครงการ ${id}`, invitation: false, agency: "กทม.", projectNumber: null, status: { label: "เผยแพร่อยู่", tone: "" }, createdAt: "2026-10-01T00:00:00.000Z" });
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("AdminTorsTable", () => {
  it("shows no bulk bar until something is ticked, then selects the whole page at once", () => {
    act(() => root.render(<AdminTorsTable rows={[row("a"), row("b")]} linkSuffix="" />));
    expect(container.querySelector('[aria-label="จัดการที่เลือก"]')).toBeNull();
    act(() => container.querySelector<HTMLInputElement>('input[aria-label="เลือกทั้งหน้านี้"]')!.click());
    expect(container.textContent).toContain("เลือก 2 รายการ");
  });

  it("takes the selected TORs down with the reason given, and keeps what failed selected", async () => {
    bulk.mockResolvedValue({ ok: true, result: { done: ["a"], failed: [{ id: "b", reason: "ไม่พบระเบียนนี้" }] } });
    act(() => root.render(<AdminTorsTable rows={[row("a"), row("b")]} linkSuffix="" />));
    act(() => container.querySelector<HTMLInputElement>('input[aria-label="เลือกทั้งหน้านี้"]')!.click());
    act(() => button("ถอดจากหน้าสาธารณะ")!.click());

    // No reason, no take-down.
    const confirm = [...container.querySelectorAll("dialog button")].find((b) => b.textContent === "ถอดจากหน้าสาธารณะ") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const reason = container.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(reason, "ซ้ำกับประกาศอื่น");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { confirm.click(); });

    expect(bulk).toHaveBeenCalledWith("reject", ["a", "b"], "ซ้ำกับประกาศอื่น");
    expect(container.textContent).toContain("ไม่สำเร็จ 1 รายการ: ไม่พบระเบียนนี้");
    expect(container.textContent).toContain("เลือก 1 รายการ");
  });

  it("shows the API's own reason when the whole request is refused", async () => {
    bulk.mockResolvedValue({ ok: false, reason: "เลือกได้ไม่เกิน 100 รายการ" });
    act(() => root.render(<AdminTorsTable rows={[row("a")]} linkSuffix="" />));
    act(() => container.querySelector<HTMLInputElement>('input[aria-label="เลือก โครงการ a"]')!.click());
    act(() => button("คืนสู่หน้าสาธารณะ")!.click());
    const confirm = [...container.querySelectorAll("dialog button")].find((b) => b.textContent === "คืนสู่หน้าสาธารณะ") as HTMLButtonElement;
    await act(async () => { confirm.click(); });
    expect(container.textContent).toContain("เลือกได้ไม่เกิน 100 รายการ");
  });
});
