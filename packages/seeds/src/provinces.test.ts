import { describe, expect, it } from "vitest";
import { PROVINCES, REGIONS } from "./provinces.js";

describe("Thailand provinces", () => {
  it("contains all 77 provinces exactly once", () => expect(new Set(PROVINCES.map((p) => p.id)).size).toBe(77));
  it("assigns each province to one of the six regions", () => {
    const ids = new Set(REGIONS.map((region) => region.id));
    expect(PROVINCES).toHaveLength(77);
    for (const province of PROVINCES) expect(ids.has(province.region)).toBe(true);
    for (const region of REGIONS) expect(PROVINCES.some((province) => province.region === region.id)).toBe(true);
  });
  it("uses Thai presentation names", () => {
    for (const province of PROVINCES) expect(province.th).toMatch(/[ก-๙]/);
  });
});
