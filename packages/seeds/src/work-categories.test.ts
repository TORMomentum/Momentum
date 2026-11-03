import { describe, expect, it } from "vitest";
import {
  NOT_A_CATEGORY,
  TAXONOMY_VERSION,
  WORK_CATEGORIES,
  WORK_CATEGORY_LEAVES,
} from "./work-categories.js";
import { TOR_CATEGORIES } from "@tor-radar/shared";

describe("the work taxonomy", () => {
  it("crosswalks every leaf to one or more closed national TOR categories", () => {
    for (const leaf of WORK_CATEGORY_LEAVES) {
      expect(leaf.torCategories.length).toBeGreaterThan(0);
      for (const category of leaf.torCategories) expect(TOR_CATEGORIES).toContain(category);
    }
  });
  it("gives every group and leaf an id that is unique across the whole tree", () => {
    const ids = [...WORK_CATEGORIES.map((g) => g.id), ...WORK_CATEGORY_LEAVES.map((l) => l.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names a leaf after the group it belongs to, so a stored id states its own parent", () => {
    // Matching scores a vendor who picked a group against a TOR classified to a
    // leaf beneath it. That relationship has to survive being written to a
    // database as a bare string.
    for (const leaf of WORK_CATEGORY_LEAVES) {
      expect(leaf.id.startsWith(`${leaf.groupId}.`)).toBe(true);
    }
  });

  it("is two levels deep and no deeper", () => {
    for (const group of WORK_CATEGORIES) {
      expect(group.children.length).toBeGreaterThan(0);
      for (const leaf of group.children) {
        expect(Object.keys(leaf)).toEqual(expect.arrayContaining(["id", "th", "synonyms", "torCategories"]));
        expect((leaf as { children?: unknown }).children).toBeUndefined();
      }
    }
  });

  it("gives every leaf at least one word an announcement would actually use", () => {
    for (const leaf of WORK_CATEGORY_LEAVES) {
      expect(leaf.synonyms.length).toBeGreaterThan(0);
      for (const word of leaf.synonyms) expect(word.trim()).toBe(word);
    }
  });

  it("labels everything in Thai, because the taxonomy is what a vendor reads", () => {
    const thai = /[฀-๿]/;
    for (const group of WORK_CATEGORIES) expect(group.th).toMatch(thai);
    for (const leaf of WORK_CATEGORY_LEAVES) expect(leaf.th).toMatch(thai);
  });

  it("covers every category the live corpus actually contains", () => {
    // Taken from the collected records on 2026-10-07. A taxonomy that cannot
    // place the documents already held would be an invented vocabulary.
    const corpus: Array<[string, string]> = [
      ["งานก่อสร้าง-ทาง", "construction.road"],
      ["ก่อสร้าง / ปรับปรุงอาคาร", "construction.building"],
      ["ซื้อครุภัณฑ์", "goods"],
      ["จ้างเหมาบริการ", "services"],
      ["ไอที/ซอฟต์แวร์", "it.software"],
    ];
    const known = new Set([
      ...WORK_CATEGORIES.map((g) => g.id),
      ...WORK_CATEGORY_LEAVES.map((l) => l.id),
    ]);
    for (const [, target] of corpus) expect(known.has(target)).toBe(true);
  });

  it("rejects a procurement method, which the corpus holds in the category field", () => {
    // "ประกวดราคาอิเล็กทรอนิกส์" appears as a category on a real record. It
    // describes how the purchase is run, not what is being bought, and must
    // never be classified as work.
    expect(NOT_A_CATEGORY).toContain("ประกวดราคาอิเล็กทรอนิกส์");
    const leafWords = new Set(WORK_CATEGORY_LEAVES.flatMap((l) => [l.th, ...l.synonyms]));
    for (const method of NOT_A_CATEGORY) expect(leafWords.has(method)).toBe(false);
  });

  it("leaves no national category without a kind of work pointing at it", () => {
    // A category nothing maps to is one no vendor can ever be matched to. The
    // first crosswalk left "งานก่อสร้าง-อื่น ๆ" and "เช่า" like that, so every
    // TOR the normaliser filed there was invisible to everyone.
    const reached = new Set(WORK_CATEGORY_LEAVES.flatMap((leaf) => leaf.torCategories));
    for (const category of TOR_CATEGORIES) expect(reached.has(category)).toBe(true);
  });

  it("carries a version, so a match made under an older vocabulary can be explained", () => {
    // A date, with an optional letter when the vocabulary changes twice in one
    // day — which it did the day it was first seeded.
    expect(TAXONOMY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}[a-z]?$/);
  });
});
