// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { AccountView } from "./AccountActionViews";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const consent = { noticeVersion: "1", agreedAt: "2026-11-01T00:00:00.000Z" };

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(text))!;
  return act(async () => button.click());
}

describe("AccountView — behaviour recording", () => {
  it("is not offered while scoring by behaviour is off", () => {
    act(() => root.render(<AccountView consent={consent} behaviour={null} />));
    expect(container.textContent).not.toContain("การบันทึกพฤติกรรมการใช้งาน");
  });

  it("turns on and off on its own, apart from the account consent, and says that switching off deletes", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    act(() => root.render(<AccountView consent={consent} behaviour={{ consent: null }} />));
    expect(container.textContent).toContain("การบันทึกพฤติกรรมการใช้งาน (ไม่บังคับ)");

    await click("เปิดการบันทึก");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/auth/me/consent/behaviour");
    expect(container.textContent).toContain("เปิดการบันทึกแล้ว");

    await click("ปิดการบันทึกและลบข้อมูลที่บันทึกไว้");
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/auth/me/consent/behaviour/withdraw");
    expect(container.textContent).toContain("ลบข้อมูลที่บันทึกไว้แล้ว");
    // The account consent was never touched.
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/me/consent/withdraw")).toBe(false);
  });

  it("starts on for a vendor who already agreed and has not withdrawn", () => {
    act(() => root.render(<AccountView consent={consent} behaviour={{ consent: { agreedAt: "2026-11-02T00:00:00.000Z" } }} />));
    expect(container.textContent).toContain("ปิดการบันทึกและลบข้อมูลที่บันทึกไว้");
  });
});
