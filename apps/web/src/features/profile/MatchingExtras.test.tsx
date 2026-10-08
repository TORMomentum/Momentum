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

    const road = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => road.click());
    // A ticked branch asks for its class.
    expect(container.querySelector('select[aria-label="ชั้นทะเบียน งานก่อสร้างทาง"]')).not.toBeNull();

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ pastProjects: [{ id: "p1", title: "ก่อสร้างถนน คสล. หมู่ 5", year: 2567, valueThb: 4_800_000 }], certifications: { cgd: [{ branch: "road", grade: 5 }], tags: [], other: [] } }), { status: 200 }));
    await act(async () => click("บันทึกผลงานและใบอนุญาต"));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/me/profile/extras");
    expect(JSON.parse(init.body)).toEqual({
      // No id on a row added here: the server assigns it.
      pastProjects: [{ title: "ก่อสร้างถนน คสล. หมู่ 5", year: 2567, valueThb: 4_800_000 }],
      certifications: { cgd: [{ branch: "road", grade: 5 }], tags: [], other: [] },
    });
    expect(container.textContent).toContain("บันทึกแล้ว");
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
