// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { MatchingExtras } from "./MatchingExtras";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

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

function render() {
  act(() => root.render(<MatchingExtras initialProjects={[]} initialCertifications={null} />));
}

function type(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(text))!;
  act(() => button.click());
}

describe("MatchingExtras", () => {
  it("adds a past project typed the way Thai contracts state it, and saves it with the certifications", async () => {
    render();
    type("ชื่อผลงาน", "ก่อสร้างถนน คสล. หมู่ 5");
    type("ปี พ.ศ.", "๒๕๖๗");
    type("มูลค่าสัญญา (บาท)", "4,800,000");
    click("+ เพิ่มผลงาน");
    expect(container.textContent).toContain("ก่อสร้างถนน คสล. หมู่ 5");

    const road = [...container.querySelectorAll("button")].find((button) => button.textContent === "ทาง")!;
    act(() => road.click());
    // No class is asked: matching does not use it.
    expect(container.querySelector("select")).toBeNull();

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ pastProjects: [{ id: "p1", title: "ก่อสร้างถนน คสล. หมู่ 5", year: 2567, valueThb: 4_800_000 }], certifications: { cgd: [{ branch: "road" }], tags: [], other: [] } }), { status: 200 }));
    await act(async () => click("บันทึกผลงานและใบอนุญาต"));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/me/profile/extras");
    expect(JSON.parse(init.body)).toEqual({
      // No id on a row added here: the server assigns it.
      pastProjects: [{ title: "ก่อสร้างถนน คสล. หมู่ 5", year: 2567, valueThb: 4_800_000 }],
      certifications: { cgd: [{ branch: "road" }], tags: [], other: [] },
      personnel: [],
    });
    expect(container.textContent).toContain("บันทึกแล้ว");
  });

  it("adds a member of staff by role, ticks what they hold, and saves it with the rest", async () => {
    render();
    type("ตำแหน่งบุคลากร", "วิศวกรโยธา");
    click("+ เพิ่มบุคลากร");
    expect(container.textContent).toContain("วิศวกรโยธา");
    // No name is asked for.
    expect(container.querySelector('input[aria-label*="ชื่อ"][aria-label*="บุคลากร"]')).toBeNull();

    // A person holds a licence to practise, not the company's ISO, มอก. or SME.
    const offered = [...container.querySelectorAll('[aria-label="ใบอนุญาตของ วิศวกรโยธา"] button')].map((button) => button.textContent);
    expect(offered).toHaveLength(2);
    expect(offered.join(" ")).not.toContain("ISO");
    const engineer = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="ใบอนุญาตของ วิศวกรโยธา"] button')].find((button) => button.textContent?.includes("ใบอนุญาตวิศวกร"))!;
    act(() => engineer.click());
    expect(engineer.getAttribute("aria-pressed")).toBe("true");

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ pastProjects: [], certifications: { cgd: [], tags: [], other: [] }, personnel: [{ id: "m1", role: "วิศวกรโยธา", certifications: ["engineer"], other: [] }] }), { status: 200 }));
    await act(async () => click("บันทึกผลงานและใบอนุญาต"));

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.personnel).toEqual([{ role: "วิศวกรโยธา", certifications: ["engineer"], other: [] }]);
    // Only staff were edited: the company's certificates stay "not stated", they are not sent as "none".
    expect(body).not.toHaveProperty("certifications");
    expect(container.textContent).toContain("บันทึกแล้ว");
  });

  it("removes a member of staff", () => {
    act(() => root.render(<MatchingExtras initialProjects={[]} initialCertifications={null} initialPersonnel={[{ id: "m1", role: "ช่างไฟฟ้า", certifications: [], other: [] }]} />));
    expect(container.textContent).toContain("ช่างไฟฟ้า");
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="ลบ ช่างไฟฟ้า"]')!.click());
    expect(container.textContent).not.toContain("ช่างไฟฟ้า");
  });

  it("shows the upload as coming, not as something that silently does nothing", () => {
    render();
    expect(container.querySelector('[aria-disabled="true"]')?.textContent).toContain("เร็วๆ นี้");
  });

  it("does not offer to save before anything has changed", () => {
    render();
    const save = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes("บันทึกผลงานและใบอนุญาต"))!;
    expect(save.disabled).toBe(true);
  });
});
