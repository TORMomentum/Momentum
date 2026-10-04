import { describe, expect, it } from "vitest";
import { knownFieldsFromFeedItem } from "./enrich.js";

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
