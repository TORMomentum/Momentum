import { describe, expect, it } from "vitest";
import { profileCompleteness, type CompletenessInput } from "./profile-completeness";

const BASE: CompletenessInput = {
  categories: ["it"],
  areas: ["thailand"],
  budget: null,
  pastProjects: [],
  certifications: null,
  personnel: [],
};

describe("profileCompleteness (TOR-214)", () => {
  it("counts the three registration answers, with no budget as an answer", () => {
    const result = profileCompleteness(BASE);
    expect(result.percent).toBe(50);
    expect(result.missing.map((item) => item.key)).toEqual(["pastProjects", "certifications", "personnel"]);
  });

  it("counts a stated 'no certifications' as answered, and an unstated one as missing", () => {
    const stated = profileCompleteness({ ...BASE, certifications: { cgd: [], tags: [], other: [] } });
    expect(stated.missing.map((item) => item.key)).not.toContain("certifications");
    expect(stated.percent).toBe(66);
  });

  it("is 100 with nothing missing once every item is given", () => {
    const result = profileCompleteness({
      ...BASE,
      pastProjects: [{ id: "p1", title: "ระบบ", year: 2567, valueThb: null }],
      certifications: { cgd: [], tags: [], other: [] },
      personnel: [{ id: "s1", role: "วิศวกร", certifications: [], other: [] }],
    });
    expect(result.percent).toBe(100);
    expect(result.missing).toEqual([]);
  });

  it("names what each missing item adds and links to its section", () => {
    const result = profileCompleteness({ ...BASE, categories: [] });
    const categories = result.missing.find((item) => item.key === "categories");
    expect(categories?.href).toBe("#matching-fields");
    expect(result.missing.find((item) => item.key === "pastProjects")?.href).toBe("#matching-extras");
    for (const item of result.missing) expect(item.adds).toMatch(/[ก-๙]/);
  });
});
