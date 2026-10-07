// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { VendorProfileView } from "./VendorProfileView";

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
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("บันทึกโปรไฟล์"),
  ) as HTMLButtonElement;
}

/** A reply as the API actually sends it: the vendor's answers plus its own stamps. */
const FROM_API = {
  categories: ["it"],
  areas: ["thailand"],
  otherCategories: [],
  budget: null,
  taxonomyVersion: "2026-10-07b",
  updatedAt: "2026-10-07T00:00:00.000Z",
};

describe("VendorProfileView", () => {
  it("sends only the vendor's own answers, never the fields the server stamps", async () => {
    // Holding the whole reply in state and posting it back sent taxonomyVersion
    // and updatedAt with it, and the API refused the save outright.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => FROM_API });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(<VendorProfileView initial={FROM_API} />);
    });
    await act(async () => {
      saveButton().click();
    });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["areas", "budget", "categories", "otherCategories"]);
  });

  it("does not put a validator's own English wording in front of a Thai reader", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { issues: [{ message: 'Unrecognized keys: "updatedAt"' }] } }),
      }),
    );

    act(() => {
      root.render(<VendorProfileView initial={FROM_API} />);
    });
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

    act(() => {
      root.render(<VendorProfileView initial={FROM_API} />);
    });
    await act(async () => {
      saveButton().click();
    });

    expect(container.textContent).toContain("มีหมวดหมู่งานที่ไม่อยู่ในรายการ");
  });
});
