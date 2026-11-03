import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, hasActiveFilters, parseSearchParams, toSearchQuery } from "./search.params";

describe("search URL canonicalisation", () => {
  it("gives two spellings of one search the same URL", () => {
    const a = toSearchQuery(
      parseSearchParams({ category: ["ซื้อครุภัณฑ์", "งานก่อสร้าง-ทาง"], agency: "สำนักการโยธา", q: "  ถนน " }),
    );
    const b = toSearchQuery(
      parseSearchParams({ q: "ถนน", agency: ["สำนักการโยธา", "สำนักการโยธา"], category: ["งานก่อสร้าง-ทาง", "ซื้อครุภัณฑ์"] }),
    );

    expect(a).toBe(b);
  });

  it("normalises Thai text to NFC, so reordered marks are one search", () => {
    const typed = "ปู่"; // tone mark before the lower vowel
    expect(parseSearchParams({ q: typed }).q).toBe("ปู่");
  });

  it("omits empty and default values, so no filters is an empty query", () => {
    expect(toSearchQuery(EMPTY_FILTERS)).toBe("");
    expect(toSearchQuery(parseSearchParams({ q: "   ", agency: "", open: "false" }))).toBe("");
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("round-trips every filter", () => {
    const filters = {
      q: "ขุดลอก",
      agencies: ["สำนักงานเขตทวีวัฒนา"],
      categories: ["งานก่อสร้าง-ชลประทาน"],
      open: true,
      state: "awaiting-invitation" as const,
      minBudget: 1_000_000,
      maxBudget: 6_000_000,
      deadlineFrom: "2026-09-01",
      deadlineTo: "2026-09-30",
      maxMatch: 90,
      minMatch: 70,
      cursor: "eyJhIjpudWxsfQ",
    };

    expect(parseSearchParams(Object.fromEntries(new URLSearchParams(toSearchQuery(filters))))).toEqual(filters);
  });

  it("drops what it cannot read instead of failing the page", () => {
    const filters = parseSearchParams({
      minBudget: "lots",
      deadlineFrom: "2026-02-30",
      deadlineTo: "30/09/2026",
      cursor: "{\"$gt\":1}",
    });

    expect(filters.minBudget).toBeNull();
    expect(filters.deadlineFrom).toBeNull();
    expect(filters.deadlineTo).toBeNull();
    expect(filters.cursor).toBeNull();
    expect(parseSearchParams({ minMatch: "-1" }).minMatch).toBeNull();
    expect(parseSearchParams({ maxMatch: "100" }).maxMatch).toBe(100);
    expect(parseSearchParams({ minMatch: "101" }).minMatch).toBeNull();
    expect(parseSearchParams({ minMatch: "7.5" }).minMatch).toBeNull();
    expect(parseSearchParams({ minMatch: "63" }).minMatch).toBe(63);
  });

  it("does not count the page position as a filter", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, cursor: "abc" })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, open: true })).toBe(true);
  });
});
