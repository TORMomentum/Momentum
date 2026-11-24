import { describe, expect, it } from "vitest";
import { competitionByCategory, type AwardedProject } from "./competition.js";

const win = (category: string, awardId: string, winner: string): AwardedProject => ({ category, awardId, winner });
const settings = { topWinners: 3, minAwarded: 4 };

describe("competitionByCategory (TOR-280)", () => {
  it("counts awarded projects, distinct winners and the top winners' share per category", () => {
    const rows = competitionByCategory([
      win("ก่อสร้าง", "a1", "บริษัท เอ จำกัด"),
      win("ก่อสร้าง", "a2", "บริษัท เอ จำกัด"),
      win("ก่อสร้าง", "a3", "บริษัท บี จำกัด"),
      win("ก่อสร้าง", "a4", "บริษัท ซี จำกัด"),
      win("ก่อสร้าง", "a5", "บริษัท ดี จำกัด"),
    ], settings);

    // A wins 2, B, C and D win 1 each: the top three hold 4 of 5.
    expect(rows).toEqual([{ category: "ก่อสร้าง", awarded: 5, winners: 4, topShare: 0.8, eligible: true }]);
  });

  it("counts a project once even when several TOR records carry its award", () => {
    const rows = competitionByCategory([
      win("ก่อสร้าง", "a1", "บริษัท เอ จำกัด"),
      win("ก่อสร้าง", "a1", "บริษัท เอ จำกัด"),
      win("ก่อสร้าง", "a2", "บริษัท บี จำกัด"),
    ], settings);

    expect(rows[0]).toMatchObject({ awarded: 2, winners: 2 });
  });

  it("treats a name that differs only in spacing as one winner, and leaves the name itself alone", () => {
    const rows = competitionByCategory([
      win("ก่อสร้าง", "a1", "บริษัท  เอ   จำกัด"),
      win("ก่อสร้าง", "a2", " บริษัท เอ จำกัด "),
    ], settings);

    expect(rows[0]).toMatchObject({ awarded: 2, winners: 1, topShare: 1 });
  });

  it("lists a category below the minimum sample but does not mark it comparable", () => {
    const rows = competitionByCategory([win("ยา", "a1", "บริษัท เอ จำกัด"), win("ยา", "a2", "บริษัท บี จำกัด")], settings);

    expect(rows).toEqual([{ category: "ยา", awarded: 2, winners: 2, topShare: 1, eligible: false }]);
  });

  it("is eligible exactly at the minimum", () => {
    const four = ["a", "b", "c", "d"].map((id) => win("ยา", id, `บริษัท ${id} จำกัด`));

    expect(competitionByCategory(four, settings)[0]?.eligible).toBe(true);
    expect(competitionByCategory(four.slice(0, 3), settings)[0]?.eligible).toBe(false);
  });

  it("follows the configured number of top winners", () => {
    const projects = ["a", "a", "b", "c"].map((name, index) => win("ยา", `p${index}`, name));

    expect(competitionByCategory(projects, { ...settings, topWinners: 1 })[0]?.topShare).toBe(0.5);
    expect(competitionByCategory(projects, { ...settings, topWinners: 2 })[0]?.topShare).toBe(0.75);
  });

  it("ignores a row with no winner or no category, and returns nothing for no projects", () => {
    expect(competitionByCategory([win("ยา", "a1", "  "), win("", "a2", "บริษัท เอ จำกัด")], settings)).toEqual([]);
    expect(competitionByCategory([], settings)).toEqual([]);
  });

  it("orders categories alphabetically in Thai", () => {
    const rows = competitionByCategory([win("ยา", "a", "x"), win("ก่อสร้าง", "b", "y")], settings);

    expect(rows.map((row) => row.category)).toEqual(["ก่อสร้าง", "ยา"]);
  });
});
