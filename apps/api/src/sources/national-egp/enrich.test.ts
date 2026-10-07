import { describe, expect, it } from "vitest";
import { knownFieldsFromFeedItem, knownFieldsFromListItem } from "./enrich.js";

const item = {
  title: "ประกวดราคาซื้อหินใหญ่คละ ขนาด ๑๕-๓๐ ซม.",
  projectId: "69099218130",
  procurementMethod: "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
};

describe("knownFieldsFromFeedItem", () => {
  it("records what the feed states as verified source values, not as extractions", () => {
    const fields = knownFieldsFromFeedItem(item);

    for (const name of ["title", "referenceNo", "procurementMethod"] as const) {
      expect(fields?.[name]).toMatchObject({ confidence: 1, verified: true, origin: "source" });
    }
  });

  it("keeps the published wording exactly, Thai digits included", () => {
    expect(knownFieldsFromFeedItem(item)?.title).toMatchObject({ raw: item.title, value: item.title });
  });

  it("leaves agency and budget to extraction, because the feed does not state them", () => {
    const fields = knownFieldsFromFeedItem(item);

    expect(fields?.agency).toBeUndefined();
    expect(fields?.budget).toBeUndefined();
  });

  it("returns undefined when the item states nothing usable", () => {
    expect(knownFieldsFromFeedItem({ title: "  " })).toBeUndefined();
  });
});

describe("knownFieldsFromListItem", () => {
  const row = {
    projectId: "69109068322",
    title: "ประกวดราคาซื้อเวชภัณฑ์ยา Ketoanalogues 600 mg Tablet",
    agency: "สถาบันโรคทรวงอก",
    announcedOn: "2026-10-06",
    budget: { raw: "2,311,200.00", value: 2_311_200 },
  };

  it("records the list's title, project number, agency and budget as verified source values", () => {
    const fields = knownFieldsFromListItem(row);

    for (const name of ["title", "referenceNo", "agency", "budget"] as const) {
      expect(fields?.[name]).toMatchObject({ confidence: 1, verified: true, origin: "source" });
    }
    expect(fields?.budget).toMatchObject({ raw: "2,311,200.00", value: 2_311_200, currency: "THB" });
    expect(fields?.agency?.value).toBe("สถาบันโรคทรวงอก");
  });

  it("leaves the budget to extraction when the list states none", () => {
    expect(knownFieldsFromListItem({ ...row, budget: undefined })?.budget).toBeUndefined();
  });
});
