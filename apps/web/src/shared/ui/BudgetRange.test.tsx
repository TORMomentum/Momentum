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

  it("keeps the handles movable when both are pushed to the same end", () => {
    // Both at the ceiling: the max handle used to sit on top and could not
    // move — not right (ceiling), not left (past min) — and min was buried.
    const onChange = render(100_000_000, 100_000_000);
    const [minRange, maxRange] = [...container.querySelectorAll('input[type="range"]')] as HTMLInputElement[];
    expect(minRange!.className).toMatch(/rangeInputTop/);

    // Both at the floor: max stays on top, and it is the one that can move.
    act(() => root.render(<BudgetRange min={0} max={0} floor={0} ceiling={100_000_000} step={100_000} onChange={onChange} />));
    expect(minRange!.className).not.toMatch(/rangeInputTop/);
    expect(maxRange!.className).not.toMatch(/rangeInputTop/);
  });

  describe("pressing the track", () => {
    // jsdom has no layout: give the track a known 1000px box at x = 0.
    function pressTrackAt(x: number) {
      const track = container.querySelector<HTMLDivElement>('input[type="range"]')!.parentElement!;
      track.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 28, right: 1000, bottom: 28, x: 0, y: 0, toJSON: () => ({}) });
      act(() => {
        // jsdom has no PointerEvent; React reads clientX either way.
        track.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x }));
      });
    }

    it("moves the max handle when pressed beyond it", () => {
      const onChange = render(10_000_000, 50_000_000);
      pressTrackAt(800);
      expect(onChange).toHaveBeenCalledWith({ min: 10_000_000, max: 80_000_000 });
    });

    it("moves the min handle when pressed before it", () => {
      const onChange = render(10_000_000, 50_000_000);
      pressTrackAt(50);
      expect(onChange).toHaveBeenCalledWith({ min: 5_000_000, max: 50_000_000 });
    });

    it("moves whichever handle is nearer when pressed between them, snapped to the step", () => {
      const onChange = render(10_000_000, 50_000_000);
      pressTrackAt(421);
      expect(onChange).toHaveBeenCalledWith({ min: 10_000_000, max: 42_100_000 });
      pressTrackAt(201);
      expect(onChange).toHaveBeenLastCalledWith({ min: 20_100_000, max: 50_000_000 });
    });
  });

  describe("single handle", () => {
    function renderSingle(min: number, onChange = vi.fn()) {
      act(() => root.render(<BudgetRange single unit="percent" min={min} max={95} floor={50} ceiling={95} step={5} onChange={onChange} />));
      return onChange;
    }

    it("has one handle and one box, and keeps the top end at the ceiling", () => {
      const onChange = renderSingle(70);
      expect(container.querySelectorAll('input[type="range"]').length).toBe(1);
      expect(boxes().map((box) => box.value)).toEqual(["70"]);
      type(boxes()[0]!, "85");
      press(boxes()[0]!, "Enter");
      expect(onChange).toHaveBeenCalledWith({ min: 85, max: 95 });
    });

    it("moves its one handle wherever the track is pressed", () => {
      const onChange = renderSingle(70);
      const track = container.querySelector<HTMLDivElement>('input[type="range"]')!.parentElement!;
      track.getBoundingClientRect = () => ({ left: 0, width: 900, top: 0, height: 28, right: 900, bottom: 28, x: 0, y: 0, toJSON: () => ({}) });
      act(() => {
        // jsdom has no PointerEvent; React reads clientX either way.
        track.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 900 }));
      });
      expect(onChange).toHaveBeenCalledWith({ min: 95, max: 95 });
    });
  });
});
