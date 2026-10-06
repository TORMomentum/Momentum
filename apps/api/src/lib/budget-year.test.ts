import { describe, expect, it } from "vitest";
import { budgetYearOf } from "./budget-year.js";

const TZ = "Asia/Bangkok";

describe("budgetYearOf", () => {
  it("names a fiscal year for the Buddhist-era year it ends in", () => {
    // 1 Oct 2025 CE starts the year that ends 30 Sep 2026 CE = 2569 BE.
    expect(budgetYearOf(new Date("2025-10-01T03:00:00Z"), TZ)).toBe(2569);
    expect(budgetYearOf(new Date("2026-09-30T03:00:00Z"), TZ)).toBe(2569);
  });

  it("moves to the next year on 1 October", () => {
    expect(budgetYearOf(new Date("2026-09-30T03:00:00Z"), TZ)).toBe(2569);
    expect(budgetYearOf(new Date("2026-10-01T03:00:00Z"), TZ)).toBe(2570);
  });

  it("uses Bangkok's calendar, not UTC", () => {
    // 2026-09-30T18:00Z is already 1 October in Bangkok, so the year has turned.
    expect(budgetYearOf(new Date("2026-09-30T18:00:00Z"), TZ)).toBe(2570);
  });

  it("has no answer without an announcement date, and does not invent one", () => {
    expect(budgetYearOf(null, TZ)).toBeNull();
    expect(budgetYearOf(new Date("not a date"), TZ)).toBeNull();
  });
});
