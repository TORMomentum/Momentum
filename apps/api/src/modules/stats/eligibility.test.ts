import { describe, expect, it } from "vitest";
import { eligibilityOf, eligibleFilter } from "./eligibility.js";

const bounds = { budgetMinThb: 10_000, budgetMaxThb: 100_000_000_000 };
const eligible = {
  pipeline: { state: "published" },
  access: { restricted: false },
  fields: {
    budget: { value: 100_000, verified: true },
    category: { value: "งานก่อสร้าง", verified: true },
  },
};

describe("eligibilityOf", () => {
  it("rejects a missing or implausible budget", () => {
    expect(eligibilityOf({ ...eligible, fields: { ...eligible.fields, budget: { value: 0, verified: true } } }, bounds)).toBe("no-budget");
  });

  it("rejects a record that is not published", () => {
    expect(eligibilityOf({ ...eligible, pipeline: { state: "queued" } }, bounds)).toBe("not-published");
  });

  it("rejects an unverified budget", () => {
    expect(eligibilityOf({ ...eligible, fields: { ...eligible.fields, budget: { value: 100_000, verified: false } } }, bounds)).toBe("unverified-budget");
  });

  it("rejects a missing or unverified category", () => {
    expect(eligibilityOf({ ...eligible, fields: { ...eligible.fields, category: { value: "", verified: true } } }, bounds)).toBe("unverified-category");
  });

  it("rejects a record whose restriction state is unknown, failing closed", () => {
    expect(eligibilityOf({ ...eligible, access: {} }, bounds)).toBe("restricted");
  });

  it("rejects a restricted record", () => {
    expect(eligibilityOf({ ...eligible, access: { restricted: true } }, bounds)).toBe("restricted");
  });

  it("accepts a published, unrestricted record with verified peer fields", () => {
    expect(eligibilityOf(eligible, bounds)).toBeNull();
  });
});

describe("eligibleFilter", () => {
  it("matches the peer-statistics partial index", () => {
    expect(eligibleFilter()).toEqual({
      "pipeline.state": "published",
      "access.restricted": false,
      "fields.budget.verified": true,
      "fields.category.verified": true,
      "fields.budget.value": { $type: "number", $gt: 0 },
    });
  });
});
