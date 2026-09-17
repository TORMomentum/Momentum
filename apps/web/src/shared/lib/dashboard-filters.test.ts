import { describe, expect, it } from "vitest";
import { parseDashboardFilters, serialiseDashboardFilters } from "./dashboard-filters";

describe("dashboard filters", () => {
  it("ignores unknown and malformed values", () => {
    expect(parseDashboardFilters({
      agency: "กรมทดสอบ",
      from: "2026-13",
      minBudget: "not-a-number",
      injected: { $gt: "" },
    })).toEqual({ agency: "กรมทดสอบ" });
  });

  it("ignores reversed ranges", () => {
    expect(parseDashboardFilters({ from: "2026-09", to: "2026-01", minBudget: "20", maxBudget: "10" })).toEqual({});
  });

  it("takes the first repeated category value", () => {
    expect(parseDashboardFilters({ category: ["งานก่อสร้าง", "ไอที"] })).toEqual({ category: "งานก่อสร้าง" });
  });

  it("round-trips valid filters", () => {
    const filters = {
      agency: "กรมทดสอบ",
      category: "งานก่อสร้าง",
      from: "2026-01",
      to: "2026-09",
      minBudget: 1000,
      maxBudget: 2000,
      status: "ประกาศแล้ว",
    };
    expect(parseDashboardFilters(Object.fromEntries(serialiseDashboardFilters(filters)))).toEqual(filters);
  });

  it("omits defaults so an unfiltered dashboard has a clean URL", () => {
    expect(serialiseDashboardFilters({}).toString()).toBe("");
  });
});
