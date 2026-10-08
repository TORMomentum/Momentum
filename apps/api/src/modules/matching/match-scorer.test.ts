import "../../test/env.js";
import { describe, expect, it } from "vitest";
import { WHOLE_COUNTRY_AREA } from "@tor-radar/seeds";
import { loadConfig } from "../../core/config.js";
import type { TorDocument, VendorProfileDocument } from "../../core/db.js";
import { scoreMatch } from "./match-scorer.js";
import type { TorClassification } from "./tor-classifier.js";

const config = loadConfig(process.env);
const classification: TorClassification = { coarse: "งานก่อสร้าง-ทาง สะพาน", leaves: [{ id: "construction.road", score: 1 }], nodes: [{ id: "construction.road", score: 1 }], evidence: [], outcome: "classified", mapperVersion: "test" };
function profile(categories = ["construction.road"], budget: VendorProfileDocument["budget"] = { minThb: 100, maxThb: 200 }): VendorProfileDocument {
  return { accountId: "vendor", categories, areas: [WHOLE_COUNTRY_AREA], budget, taxonomyVersion: "test", updatedAt: new Date() };
}
function tor(overrides: Record<string, unknown> = {}): TorDocument {
  return {
    contentHash: "test", storage: { bucket: "test", key: "test", contentType: "application/pdf", bytes: 1 }, sourceRefs: [], pipeline: { state: "published", attempts: 1 },
    fields: { budget: { raw: "150", value: 150, confidence: 1, verified: true }, deadline: { raw: "2027-01-01", value: "2027-01-01", confidence: 1, verified: true } },
    announcedAt: null, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as TorDocument;
}

describe("match scorer", () => {
  it("excludes a passed deadline with a Thai reason", () => expect(scoreMatch(profile(), tor({ fields: { deadline: { value: "2020-01-01" } } }), classification, config, "2026-01-01").excluded?.code).toBe("deadline-passed"));
  it("excludes a taken-down record", () => expect(scoreMatch(profile(), tor({ access: { restricted: true } }), classification, config, "2026-01-01").excluded?.code).toBe("restricted"));
  it("rewards a leaf more than its group and another group not at all", () => {
    const leaf = scoreMatch(profile(["construction.road"]), tor(), classification, config, "2026-01-01").score;
    const group = scoreMatch(profile(["construction"]), tor(), classification, config, "2026-01-01").score;
    const other = scoreMatch(profile(["goods"]), tor(), classification, config, "2026-01-01").score;
    expect(leaf).toBeGreaterThan(group); expect(group).toBeGreaterThan(other);
  });
  it("orders exact leaf, group, coarse-only, then no taxonomy match", () => {
    const coarseOnly: TorClassification = { ...classification, leaves: [], nodes: [], coarse: "งานก่อสร้าง-ทาง สะพาน" };
    const none: TorClassification = { ...coarseOnly, coarse: null };
    const leaf = scoreMatch(profile(["construction.road"]), tor(), classification, config, "2026-01-01").score;
    const group = scoreMatch(profile(["construction"]), tor(), classification, config, "2026-01-01").score;
    const coarse = scoreMatch(profile(["construction.road"]), tor(), coarseOnly, config, "2026-01-01").score;
    const noMatch = scoreMatch(profile(["construction.road"]), tor(), none, config, "2026-01-01").score;
    expect(leaf).toBeGreaterThan(group); expect(group).toBeGreaterThan(coarse); expect(coarse).toBeGreaterThan(noMatch);
  });
  it("matches profile free text by substring below taxonomy and explains it in Thai", () => {
    const freeTextProfile = { ...profile([]), otherCategories: ["งานโดรนสำรวจ"] };
    const record = tor({ fields: { title: { value: "จัดจ้างงานโดรนสำรวจพื้นที่" }, deadline: { value: "2027-01-01" } } });
    const free = scoreMatch(freeTextProfile, record, { ...classification, coarse: null, leaves: [], nodes: [] }, config, "2026-01-01");
    const taxonomy = scoreMatch(profile(), tor(), classification, config, "2026-01-01");
    expect(free.score).toBeLessThan(taxonomy.score); expect(free.reasons).toContainEqual(expect.objectContaining({ code: "free-text", th: "คล้ายกับงานที่คุณระบุเอง: งานโดรนสำรวจ" }));
  });
  it("does not exclude or score the area when work location is unknown", () => {
    const result = scoreMatch(profile(), tor(), classification, config, "2026-01-01");
    expect(result.excluded).toBeNull(); expect(result.reasons.some((reason) => reason.code.startsWith("area"))).toBe(false);
  });
  it("does not read an issuing agency while the area signal is disabled", () => {
    const withoutAgency = scoreMatch(profile(), tor(), classification, config, "2026-01-01");
    const withAgency = scoreMatch(profile(), tor({ fields: { ...tor().fields, agency: { value: "จังหวัดเชียงใหม่" } } }), classification, config, "2026-01-01");
    expect(withAgency.score).toBe(withoutAgency.score); expect(withAgency.reasons.some((reason) => reason.code.startsWith("area"))).toBe(false);
  });
  it("lowers an outside budget without excluding", () => {
    const inside = scoreMatch(profile(), tor(), classification, config, "2026-01-01").score;
    const outside = scoreMatch(profile(), tor({ fields: { budget: { value: 500 }, deadline: { value: "2027-01-01" } } }), classification, config, "2026-01-01");
    expect(outside.excluded).toBeNull(); expect(outside.score).toBeLessThan(inside);
  });
  it("returns Thai reasons", () => {
    for (const reason of scoreMatch(profile(), tor(), classification, config, "2026-01-01").reasons) expect(/[ก-๙]/.test(reason.th)).toBe(true);
  });

  describe("past work", () => {
    const road = () => tor({ fields: { ...tor().fields, title: { raw: "ก่อสร้างถนนคอนกรีตเสริมเหล็ก", value: "ก่อสร้างถนนคอนกรีตเสริมเหล็ก", confidence: 1, verified: true } } });
    const project = (title: string) => ({ id: title, title, year: 2567, valueThb: null });

    it("lifts a TOR like work the vendor has done above one like work they have not", () => {
      const done = { ...profile(), pastProjects: [project("ก่อสร้างถนนลาดยาง หมู่ 3")] };
      const other = { ...profile(), pastProjects: [project("จัดซื้อเครื่องคอมพิวเตอร์")] };
      const similar = scoreMatch(done, road(), classification, config, "2026-01-01");
      const unlike = scoreMatch(other, road(), classification, config, "2026-01-01");
      expect(similar.score).toBeGreaterThan(unlike.score);
      expect(similar.reasons.map((reason) => reason.code)).toContain("experience");
    });

    it("costs nothing when no past work is listed", () => {
      const none = scoreMatch(profile(), road(), classification, config, "2026-01-01");
      const empty = scoreMatch({ ...profile(), pastProjects: [] }, road(), classification, config, "2026-01-01");
      expect(empty.score).toBe(none.score);
    });
  });

  describe("กรมบัญชีกลาง registration (ว642)", () => {
    const big = (title: string) => tor({ fields: { ...tor().fields, title: { raw: title, value: title, confidence: 1, verified: true }, budget: { raw: "8000000", value: 8_000_000, confidence: 1, verified: true } } });
    const wide = { minThb: 0, maxThb: 10_000_000 };

    it("lowers a large road TOR and says why when the vendor holds no road registration", () => {
      const holdsNone = { ...profile(["construction.road"], wide), certifications: { cgd: [], tags: [], other: [] } };
      const holdsRoad = { ...profile(["construction.road"], wide), certifications: { cgd: [{ branch: "road", grade: 3 }], tags: [], other: [] } };
      const missing = scoreMatch(holdsNone, big("ก่อสร้างถนนคอนกรีต"), classification, config, "2026-01-01");
      const held = scoreMatch(holdsRoad, big("ก่อสร้างถนนคอนกรีต"), classification, config, "2026-01-01");
      expect(missing.score).toBeCloseTo(held.score * config.matching.registrationMissingFactor);
      expect(missing.reasons[0]?.code).toBe("registration-missing");
      expect(held.reasons.map((reason) => reason.code)).toContain("registration-held");
    });

    it("tells a bridge from a road by the title", () => {
      const holdsRoad = { ...profile(["construction.road"], wide), certifications: { cgd: [{ branch: "road", grade: 3 }], tags: [], other: [] } };
      expect(scoreMatch(holdsRoad, big("ก่อสร้างสะพานคอนกรีต"), classification, config, "2026-01-01").reasons[0]?.code).toBe("registration-missing");
    });

    it("leaves a vendor alone until they have stated what they hold", () => {
      const unstated = profile(["construction.road"], wide);
      expect(scoreMatch(unstated, big("ก่อสร้างถนนคอนกรีต"), classification, config, "2026-01-01").reasons.map((reason) => reason.code)).not.toContain("registration-missing");
    });

    it("does not apply below the ว642 threshold", () => {
      const holdsNone = { ...profile(), certifications: { cgd: [], tags: [], other: [] } };
      expect(scoreMatch(holdsNone, tor({ fields: { ...tor().fields, title: { raw: "ก่อสร้างถนน", value: "ก่อสร้างถนน", confidence: 1, verified: true } } }), classification, config, "2026-01-01").reasons.map((reason) => reason.code)).not.toContain("registration-missing");
    });
  });
});
