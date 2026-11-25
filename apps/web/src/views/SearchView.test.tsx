// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: "a" }));

import { EMPTY_FILTERS } from "../features/search/search.params";
import { ViewerProvider } from "../shared/lib/viewer";
import { SearchView } from "./SearchView";
import type { OwnMatches } from "../shared/api/matches.api";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  push.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const VENDOR = { email: "v@example.test", name: "ผู้ขาย", role: "vendor" as const };
const RESULTS = { items: [], total: 0, nextCursor: null, coverage: { lastUpdatedAt: null } };
const FACETS = { agencies: [], categories: [], budget: null };

function render(
  account: { email: string; name: string; role: "vendor" | "admin" } | null,
  minMatch: number | null = null,
  maxMatch: number | null = null,
  extra: { recommended?: OwnMatches | null; q?: string } = {},
) {
  act(() =>
    root.render(
      <ViewerProvider initialAccount={account}>
        <SearchView
          filters={{ ...EMPTY_FILTERS, minMatch, maxMatch, q: extra.q ?? "" }}
          facets={FACETS}
          results={RESULTS}
          queryMaxChars={200}
          savedIds={[]}
          recommended={extra.recommended}
        />
      </ViewerProvider>,
    ),
  );
}

const matchBox = () => container.querySelector<HTMLInputElement>('input[type="text"][aria-label="ความตรงขั้นต่ำ"]');
const matchMaxBox = () => container.querySelector<HTMLInputElement>('input[type="text"][aria-label="ความตรงสูงสุด"]');

function typeInto(input: HTMLInputElement, value: string) {
  act(() => input.focus());
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

describe("SearchView match filter", () => {
  it("is offered to a signed-in vendor", () => {
    render(VENDOR);
    expect(container.textContent).toContain("ตรงกับคุณ");
    expect(matchBox()).not.toBeNull();
  });

  it("is offered to any signed-in account, not only one with the vendor role", () => {
    render({ email: "a@example.test", name: "ผู้ดูแล", role: "admin" });
    expect(matchBox()).not.toBeNull();
  });

  it("is not offered to a signed-out visitor, even from a stale link carrying a threshold", () => {
    render(null, 70);
    expect(matchBox()).toBeNull();
  });

  it("puts a typed threshold in the URL", () => {
    render(VENDOR);
    typeInto(matchBox()!, "70");
    act(() => vi.runAllTimers());
    expect(push).toHaveBeenCalledWith("/search?minMatch=70", { scroll: false });
  });

  it("puts a typed upper bound in the URL", () => {
    render(VENDOR);
    typeInto(matchMaxBox()!, "85");
    act(() => vi.runAllTimers());
    expect(push).toHaveBeenCalledWith("/search?maxMatch=85", { scroll: false });
  });

  it("drops the threshold from the URL when set back to zero", () => {
    render(VENDOR, 70);
    typeInto(matchBox()!, "0");
    act(() => vi.runAllTimers());
    expect(push).toHaveBeenCalledWith("/search", { scroll: false });
  });
});

const MATCHES: OwnMatches = {
  reason: null,
  items: [{
    id: "t1", title: "จ้างพัฒนาระบบสารสนเทศ", agency: "สำนักงานเขตบางรัก",
    budget: { raw: "500000", value: 500000, verified: true },
    deadline: { raw: "", value: null, verified: false },
    unverified: false, score: 0.8, reasons: [{ code: "category", th: "ตรงหมวดงานของคุณ" }],
  }],
};

const drawer = () => container.querySelector<HTMLElement>("#search-filters");
const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-controls="search-filters"]');

describe("SearchView filters on demand (TOR-217)", () => {
  it("opens with the filters closed and the results in front", () => {
    render(VENDOR);
    expect(drawer()?.hidden).toBe(true);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    // An icon, named for screen readers.
    expect(toggle()?.querySelector("svg")).not.toBeNull();
    expect(toggle()?.getAttribute("aria-label")).toBe("ตัวกรอง");
  });

  it("opens the drawer from the button, and closes it with Escape, giving focus back to the button", () => {
    render(VENDOR);
    act(() => toggle()?.click());
    expect(drawer()?.hidden).toBe(false);
    expect(drawer()?.getAttribute("role")).toBe("dialog");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(drawer()?.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle());
  });

  it("counts the filters in the drawer on its button, not the keyword", () => {
    render(VENDOR, 40, null, { q: "ถนน" });
    expect(toggle()?.getAttribute("aria-label")).toBe("ตัวกรอง (ใช้อยู่ 1)");
    expect(toggle()?.textContent).toBe("1");
  });

  it("keeps the coverage note on the page while the drawer is closed (FR-E-6)", () => {
    render(null);
    const note = [...container.querySelectorAll("p")].find((p) => p.textContent?.includes("ครอบคลุมเฉพาะเอกสารที่ระบบรวบรวมได้"));
    expect(note).toBeDefined();
    expect(drawer()?.contains(note ?? null)).toBe(false);
  });
});

describe("SearchView recommended for you (TOR-217)", () => {
  it("leads with the vendor's matches before they search", () => {
    render(VENDOR, null, null, { recommended: MATCHES });
    expect(container.textContent).toContain("แนะนำสำหรับคุณ");
    expect(container.textContent).toContain("จ้างพัฒนาระบบสารสนเทศ");
    expect(container.textContent).toContain("ตรงหมวดงานของคุณ");
  });

  it("steps aside once a keyword or filter is set", () => {
    render(VENDOR, null, null, { recommended: MATCHES, q: "ถนน" });
    expect(container.textContent).not.toContain("แนะนำสำหรับคุณ");
  });

  it("shows nothing when there are no matches to show (signed out, or they could not be read)", () => {
    render(null);
    expect(container.textContent).not.toContain("แนะนำสำหรับคุณ");
    render(VENDOR, null, null, { recommended: null });
    expect(container.textContent).not.toContain("แนะนำสำหรับคุณ");
  });

  it("sends a vendor with no work chosen to their profile", () => {
    render(VENDOR, null, null, { recommended: { items: [], reason: "กรุณาเลือกหมวดหมู่งานเพื่อดูรายการที่เกี่ยวข้อง" } });
    expect(container.textContent).toContain("กรุณาเลือกหมวดหมู่งาน");
    expect(container.querySelector('a[href="/profile"]')).not.toBeNull();
  });
});
