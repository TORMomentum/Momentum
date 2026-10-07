// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BudgetRange, parseBaht } from "./BudgetRange";

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

function render(min: number, max: number, onChange = vi.fn()) {
  act(() =>
    root.render(
      <BudgetRange min={min} max={max} floor={0} ceiling={100_000_000} step={100_000} onChange={onChange} />,
    ),
  );
  return onChange;
}

const boxes = () => [...container.querySelectorAll('input[type="text"]')] as HTMLInputElement[];

function type(input: HTMLInputElement, value: string) {
  act(() => input.focus());
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(input: HTMLInputElement, key: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("parseBaht", () => {
  it("reads money as people type it", () => {
    expect(parseBaht("5,000,000")).toBe(5_000_000);
    expect(parseBaht("5000000")).toBe(5_000_000);
    expect(parseBaht("฿ 1,200")).toBe(1_200);
    expect(parseBaht("๕,๐๐๐,๐๐๐")).toBe(5_000_000);
    expect(parseBaht("")).toBeNull();
    expect(parseBaht("abc")).toBeNull();
  });
});

describe("BudgetRange typed amounts", () => {
  it("shows both amounts formatted, and commits a typed one on Enter", () => {
    const onChange = render(500_000, 5_000_000);
    expect(boxes().map((box) => box.value)).toEqual(["500,000", "5,000,000"]);

    type(boxes()[1]!, "7,500,000");
    // Not committed while typing — the slider must not chase each keystroke.
    expect(onChange).not.toHaveBeenCalled();
    press(boxes()[1]!, "Enter");

    expect(onChange).toHaveBeenCalledWith({ min: 500_000, max: 7_500_000 });
  });

  it("commits when the box loses focus", () => {
    const onChange = render(500_000, 5_000_000);
    type(boxes()[0]!, "1000000");
    act(() => boxes()[0]!.blur());
    expect(onChange).toHaveBeenCalledWith({ min: 1_000_000, max: 5_000_000 });
  });

  it("carries the maximum up when the minimum is typed above it", () => {
    const onChange = render(500_000, 5_000_000);
    type(boxes()[0]!, "9,000,000");
    press(boxes()[0]!, "Enter");
    expect(onChange).toHaveBeenCalledWith({ min: 9_000_000, max: 9_000_000 });
  });

  it("keeps a typed amount inside the slider's range", () => {
    const onChange = render(500_000, 5_000_000);
    type(boxes()[1]!, "999,999,999,999");
    press(boxes()[1]!, "Enter");
    expect(onChange).toHaveBeenCalledWith({ min: 500_000, max: 100_000_000 });
  });

  it("puts an unreadable entry back to the current value instead of zero", () => {
    const onChange = render(500_000, 5_000_000);
    type(boxes()[0]!, "lots");
    press(boxes()[0]!, "Enter");
    expect(onChange).not.toHaveBeenCalled();
    expect(boxes()[0]!.value).toBe("500,000");
  });
});
