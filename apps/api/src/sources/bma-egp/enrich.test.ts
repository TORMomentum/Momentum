import { describe, expect, it } from "vitest";
import { knownFieldsFromProject } from "./enrich.js";

describe("knownFieldsFromProject", () => {
  it("records the issuing agency as verified, not as an extraction", () => {
    const fields = knownFieldsFromProject({ masterOrgGroupName: "สำนักการแพทย์" });

    expect(fields?.agency).toMatchObject({
      raw: "สำนักการแพทย์",
      confidence: 1,
      verified: true,
    });
  });

  it("resolves a seeded agency to its canonical id", () => {
    const fields = knownFieldsFromProject({ masterOrgGroupName: "สำนักการแพทย์" });

    // The id the source API itself accepts as a MasterOrgGroups filter.
    expect(fields?.agency.value).toEqual(expect.any(String));
  });

  it("keeps the published name for an agency that is not on the seeded list", () => {
    // Scope is national: an unseeded agency is recorded, never rejected or discarded.
    const fields = knownFieldsFromProject({ masterOrgGroupName: "เทศบาลนครเชียงใหม่" });

    expect(fields?.agency.raw).toBe("เทศบาลนครเชียงใหม่");
    // null, not undefined: TOR-88 tightened ExtractedField.value to `string | null`,
    // so "no canonical id" is expressed as null rather than an absent key.
    expect(fields?.agency.value).toBeNull();
    expect(fields?.agency.verified).toBe(true);
  });

  it("returns nothing when the project states no agency", () => {
    expect(knownFieldsFromProject({})).toBeUndefined();
    expect(knownFieldsFromProject({ masterOrgGroupName: "   " })).toBeUndefined();
  });
});
