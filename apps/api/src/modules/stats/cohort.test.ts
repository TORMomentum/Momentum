import { describe, expect, it } from "vitest";
import { cohortFor, monthKey } from "./cohort.js";

const TZ = "Asia/Bangkok";

describe("monthKey", () => {
  it("uses the Bangkok calendar, not UTC", () => {
    // 2026-03-31T17:30:00Z is 2026-04-01 00:30 in Bangkok.
    expect(monthKey(new Date("2026-03-31T17:30:00Z"), TZ)).toBe("2026-04");
  });
  it("keeps a mid-month date in its own month", () => {
    expect(monthKey(new Date("2026-03-15T06:00:00Z"), TZ)).toBe("2026-03");
  });
});

describe("cohortFor", () => {
  const category = "งานก่อสร้าง-ทาง";

  it("prefers the announcement date", () => {
    expect(
      cohortFor({ category, announcedAt: new Date("2026-02-10T03:00:00Z"), createdAt: new Date("2026-09-01T03:00:00Z") }, TZ),
    ).toEqual({ cohort: { category, month: "2026-02" }, cohortDateSource: "announced" });
  });

  it("falls back to the intake date, and says so", () => {
    expect(
      cohortFor({ category, announcedAt: null, createdAt: new Date("2026-09-01T03:00:00Z") }, TZ),
    ).toEqual({ cohort: { category, month: "2026-09" }, cohortDateSource: "intake" });
  });

  it("treats an invalid announcement date as absent", () => {
    expect(
      cohortFor({ category, announcedAt: new Date("not a date"), createdAt: new Date("2026-09-01T03:00:00Z") }, TZ),
    ).toEqual({ cohort: { category, month: "2026-09" }, cohortDateSource: "intake" });
  });

  it("returns null when the category is missing, because a cohort without a category is not a peer group", () => {
    expect(cohortFor({ category: "", announcedAt: null, createdAt: new Date() }, TZ)).toBeNull();
  });
});
