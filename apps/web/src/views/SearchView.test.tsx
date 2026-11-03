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

function render(account: { email: string; name: string; role: "vendor" | "admin" } | null, minMatch: number | null = null, maxMatch: number | null = null) {
  act(() =>
    root.render(
      <ViewerProvider initialAccount={account}>
        <SearchView filters={{ ...EMPTY_FILTERS, minMatch, maxMatch }} facets={FACETS} results={RESULTS} queryMaxChars={200} savedIds={[]} />
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
