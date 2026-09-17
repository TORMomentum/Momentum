import { describe, expect, it } from "vitest";
import { knownFieldsFromProject } from "./enrich.js";

const project = {
  projectName: "จ้างก่อสร้างปรับปรุงซอยทวีวัฒนา 19",
  projectNumber: "69019123456",
  masterOrgGroupName: "สำนักการแพทย์",
  projectBudget: 5_961_000,
};

describe("knownFieldsFromProject", () => {
  it("records what the source states as verified source values, not as extractions", () => {
    const fields = knownFieldsFromProject(project);

    for (const name of ["title", "agency", "budget", "referenceNo"] as const) {
      expect(fields?.[name]).toMatchObject({ confidence: 1, verified: true, origin: "source" });
    }
  });

  it("takes the budget from the source, as a number the anomaly rule can compute on", () => {
    const fields = knownFieldsFromProject(project);

    expect(fields?.budget).toMatchObject({ raw: "5961000", value: 5_961_000, currency: "THB" });
  });

  it("stores the agency's published name as its value, as an extracted agency does", () => {
    // Search, facets and peer groups key on agency.value; an id here would split one agency in two.
    expect(knownFieldsFromProject(project)?.agency).toMatchObject({
      raw: "สำนักการแพทย์",
      value: "สำนักการแพทย์",
    });
  });

  it("keeps the published name for an agency that is not on the seeded list", () => {
    // Scope is national: an unseeded agency is recorded, never rejected or discarded.
    const fields = knownFieldsFromProject({ masterOrgGroupName: "เทศบาลนครเชียงใหม่" });

    expect(fields?.agency).toMatchObject({ raw: "เทศบาลนครเชียงใหม่", value: "เทศบาลนครเชียงใหม่", verified: true });
  });

  it("leaves out what the project does not state, so extraction reads it from the document", () => {
    const fields = knownFieldsFromProject({ masterOrgGroupName: "สำนักการแพทย์", projectBudget: 0 });

    expect(Object.keys(fields ?? {})).toEqual(["agency"]);
  });

  it("returns nothing when the project states nothing", () => {
    expect(knownFieldsFromProject({})).toBeUndefined();
    expect(knownFieldsFromProject({ masterOrgGroupName: "   ", projectName: "" })).toBeUndefined();
  });
});
