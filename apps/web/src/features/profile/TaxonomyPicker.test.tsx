// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORK_CATEGORIES } from "@tor-radar/seeds";

import { TaxonomyPicker } from "./TaxonomyPicker";

const GROUP = WORK_CATEGORIES[0];
const LEAF_IDS = GROUP.children.map((leaf) => leaf.id);

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

function render(value: string[], onChange = vi.fn()) {
  act(() => {
    root.render(
      <TaxonomyPicker value={value} other={[]} onChange={onChange} onOtherChange={vi.fn()} />,
    );
  });
  return onChange;
}

/** The group's own control: "accept all of it" or "clear it". */
function groupAction(): HTMLButtonElement {
  const heading = [...container.querySelectorAll("h3")].find((h) => h.textContent === GROUP.th);
  return heading!.parentElement!.querySelector("button") as HTMLButtonElement;
}

function leafButton(label: string): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement;
}

function selectionCount(): string {
  return container.querySelector('[role="status"]')!.textContent ?? "";
}

describe("TaxonomyPicker", () => {
  it("counts a whole group as the work it covers, not as one entry", () => {
    // Accepting a group of eight and seeing "1 selected" read as a broken
    // control: the tally disagreed with what the screen showed.
    render([GROUP.id]);
    expect(selectionCount()).toContain(String(GROUP.children.length));
  });

  it("shows a group's work as covered when the whole group is accepted", () => {
    render([GROUP.id]);
    for (const leaf of GROUP.children) {
      expect(leafButton(leaf.th).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("offers to clear a group once anything inside it is chosen", () => {
    render([]);
    expect(groupAction().textContent).toBe("รับทั้งกลุ่ม");

    render([LEAF_IDS[0]]);
    expect(groupAction().textContent).toBe("ล้าง");

    render([GROUP.id]);
    expect(groupAction().textContent).toBe("ล้าง");
  });

  it("clears the group id and every one of its leaves together", () => {
    const other = WORK_CATEGORIES[1].children[0].id;
    const onChange = render([GROUP.id, LEAF_IDS[0], LEAF_IDS[1], other]);
    act(() => groupAction().click());
    // Another group's choice is untouched.
    expect(onChange).toHaveBeenCalledWith([other]);
  });

  it("opens a whole group into its parts when one of them is dropped", () => {
    // "All construction except irrigation" has to be expressible, and pressing
    // a single kind of work is the only way a vendor would try to say it.
    const onChange = render([GROUP.id]);
    act(() => leafButton(GROUP.children[2].th).click());

    const next = onChange.mock.calls[0][0] as string[];
    expect(next).not.toContain(GROUP.id);
    expect(next).not.toContain(LEAF_IDS[2]);
    expect(next).toEqual(expect.arrayContaining([LEAF_IDS[0], LEAF_IDS[1]]));
    expect(next).toHaveLength(GROUP.children.length - 1);
  });

  it("toggles a single kind of work normally when its group is not accepted", () => {
    const onChange = render([]);
    act(() => leafButton(GROUP.children[0].th).click());
    expect(onChange).toHaveBeenCalledWith([LEAF_IDS[0]]);
  });
});
