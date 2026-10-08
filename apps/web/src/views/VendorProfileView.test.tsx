// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ViewerProvider } from "../shared/lib/viewer";
import { VendorProfileView } from "./VendorProfileView";

/** The screen reads the signed-in account for its header, as it does in the app. */
const ACCOUNT = { email: "vendor@example.test", name: "ผู้ขาย", role: "vendor" as const };

function mount(initial: (typeof FROM_API & { updatedBy?: "vendor" | "admin" }) | null) {
  act(() => {
    root.render(
      <ViewerProvider initialAccount={ACCOUNT}>
        <VendorProfileView initial={initial} />
      </ViewerProvider>,
    );
  });
}

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
  vi.unstubAllGlobals();
});

function saveButton(): HTMLButtonElement {
  // The label differs between the two states ("บันทึกและเริ่มใช้งาน" on a first
  // run, "บันทึกการเปลี่ยนแปลง" afterwards); both are the same control.
  return [...container.querySelectorAll("button")].find((button) =>
    ["บันทึกและเริ่มใช้งาน", "บันทึกการเปลี่ยนแปลง"].includes(button.textContent?.trim() ?? ""),
  ) as HTMLButtonElement;
}

/** A reply as the API actually sends it: the vendor's answers plus its own stamps. */
const FROM_API = {
  categories: ["it"],
  areas: ["thailand"],
  otherCategories: [],
  budget: null,
  notify: { preset: "daily" as const, minMatch: 70, leadDays: 7, deadlineReminder: true, anomalyAlert: false },
  taxonomyVersion: "2026-10-07b",
  updatedAt: "2026-10-07T00:00:00.000Z",
};

describe("VendorProfileView", () => {
  it("tells the vendor when an admin last changed their answers", () => {
    mount({ ...FROM_API, updatedBy: "admin" });
    expect(container.querySelector('[role="note"]')?.textContent).toContain("ผู้ดูแลระบบแก้ไขข้อมูลส่วนนี้");
  });

  it("says nothing about admins when the vendor made the last change", () => {
    mount({ ...FROM_API, updatedBy: "vendor" });
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it("leads with the pickers when nothing has been answered yet", () => {
    mount({ ...FROM_API, categories: [] });
    expect(container.textContent).toContain("ตั้งค่าโปรไฟล์ครั้งแรก");
    expect(container.textContent).toContain("บันทึกและเริ่มใช้งาน");
    // The full taxonomy is on screen, which is the one thing to do.
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
  });

  it("leads with the answers once they exist, not with the choices again", () => {
    // A vendor coming back is owed their own words. Showing the sixty-five
    // choices every visit was the whole complaint.
    mount(FROM_API);
    expect(container.textContent).toContain(ACCOUNT.name);
    expect(container.textContent).toContain(ACCOUNT.email);
    expect(container.textContent).toContain("ข้อมูลที่ใช้จับคู่ TOR");
    expect(container.textContent).not.toContain("ตั้งค่าโปรไฟล์ครั้งแรก");
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.textContent).toContain("แก้ไข");
  });

  it("opens one section at a time, leaving the others summarised", () => {
    mount(FROM_API);
    const edit = [...container.querySelectorAll("button")].find((b) => b.textContent === "แก้ไข")!;
    act(() => edit.click());
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
    expect([...container.querySelectorAll("button")].filter((b) => b.textContent === "ปิด")).toHaveLength(1);
  });

  it("names what would sharpen matching without marking the profile incomplete", () => {
    mount(FROM_API);
    expect(container.textContent).toContain("สิ่งที่จะช่วยให้จับคู่แม่นขึ้น");
    expect(container.textContent).toContain("ไม่บังคับ");
    // A completeness figure was a literal on the screen this replaced. The
    // percentages that remain are the notification threshold, which is a real
    // setting the vendor chose.
    expect(container.textContent).not.toContain("โปรไฟล์สมบูรณ์");
  });

  it("sends only the vendor's own answers, never the fields the server stamps", async () => {
    // Holding the whole reply in state and posting it back sent taxonomyVersion
    // and updatedAt with it, and the API refused the save outright.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => FROM_API });
    vi.stubGlobal("fetch", fetchMock);

    mount(FROM_API);
    await act(async () => {
      saveButton().click();
    });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([
      "areas",
      "budget",
      "categories",
      "notify",
      "otherCategories",
    ]);
  });

  it("does not put a validator's own English wording in front of a Thai reader", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { issues: [{ message: 'Unrecognized keys: "updatedAt"' }] } }),
      }),
    );

    mount(FROM_API);
    await act(async () => {
      saveButton().click();
    });

    expect(container.textContent).not.toContain("Unrecognized keys");
    expect(container.textContent).toContain("ไม่สามารถบันทึกโปรไฟล์ได้");
  });

  it("shows the server's Thai reason when it states one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { issues: [{ message: "มีหมวดหมู่งานที่ไม่อยู่ในรายการ" }] } }),
      }),
    );

    mount(FROM_API);
    await act(async () => {
      saveButton().click();
    });

    expect(container.textContent).toContain("มีหมวดหมู่งานที่ไม่อยู่ในรายการ");
  });
});
