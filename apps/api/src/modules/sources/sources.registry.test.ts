import { describe, expect, it } from "vitest";
import { BMA_EGP_IMPORT_ID, NATIONAL_EGP_AWARDS_ID, NATIONAL_EGP_IMPORT_ID, SOURCES, sourcesFor, STAGES_SOURCE_ID } from "./sources.registry.js";

const kinds = (enabled: boolean) => Object.fromEntries(sourcesFor({ collector: { enabled } }).map((source) => [source.id, source.kind]));

describe("sourcesFor (spec 2026-11-25-scheduled-collector decision 10)", () => {
  it("makes the collector's two sources automatic only while the collector is enabled", () => {
    expect(kinds(false)).toEqual({
      [STAGES_SOURCE_ID]: "automatic",
      [NATIONAL_EGP_IMPORT_ID]: "manual",
      [NATIONAL_EGP_AWARDS_ID]: "manual",
      [BMA_EGP_IMPORT_ID]: "manual",
    });
    expect(kinds(true)).toEqual({
      [STAGES_SOURCE_ID]: "automatic",
      [NATIONAL_EGP_IMPORT_ID]: "automatic",
      [NATIONAL_EGP_AWARDS_ID]: "automatic",
      [BMA_EGP_IMPORT_ID]: "manual",
    });
  });

  it("keeps the registry's order and leaves the registry itself unchanged", () => {
    expect(sourcesFor({ collector: { enabled: true } }).map((source) => source.id)).toEqual(SOURCES.map((source) => source.id));
    expect(SOURCES.find((source) => source.id === NATIONAL_EGP_IMPORT_ID)?.kind).toBe("manual");
  });
});
