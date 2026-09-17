import { describe, expect, it } from "vitest";
import { parseBudget } from "./parse-budget.js";

describe("parseBudget", () => {
  const maximum = 100_000_000_000;

  it("normalises Thai digits and separators into a finite Thai-baht amount", () => {
    expect(parseBudget("1,200,000", maximum)).toBe(1_200_000);
    expect(parseBudget("๑,๒๐๐,๐๐๐", maximum)).toBe(1_200_000);
    expect(parseBudget("1200000.50", maximum)).toBe(1_200_000.5);
  });

  it("rejects text, non-positive amounts, and amounts beyond the configured maximum", () => {
    expect(parseBudget("ประมาณ", maximum)).toBeNull();
    expect(parseBudget("0", maximum)).toBeNull();
    expect(parseBudget("-5", maximum)).toBeNull();
    expect(parseBudget("100000000001", maximum)).toBeNull();
  });
});
