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
  describe("meaning of free text (TOR-202)", () => {
    const on = { ...config, embeddings: { ...config.embeddings, enabled: true, minSimilarity: 0.75 } };
    const none = { ...classification, coarse: null, leaves: [], nodes: [] };
    const vendor = (over: Partial<VendorProfileDocument> = {}): VendorProfileDocument => ({
      ...profile([]), otherCategories: ["ถ่ายภาพทางอากาศ"],
      otherCategoryVectors: [{ text: "ถ่ายภาพทางอากาศ", model: "m", vector: [1, 0] }], ...over,
    });
    const record = (vector: number[], model = "m") => tor({ embedding: { model, vector }, fields: { title: { value: "จ้างสำรวจด้วยอากาศยานไร้คนขับ" }, deadline: { value: "2027-01-01" } } });
    const codes = (result: ReturnType<typeof scoreMatch>) => result.reasons.map((reason) => reason.code);

    it("matches by meaning when no word of the phrase appears, and explains it", () => {
      const result = scoreMatch(vendor(), record([0.9, 0.1]), none, on, "2026-01-01");
      expect(result.reasons).toContainEqual(expect.objectContaining({ code: "free-text-meaning", th: "ความหมายใกล้เคียงกับงานที่คุณระบุเอง: ถ่ายภาพทางอากาศ" }));
    });

    it("does not match a different kind of work, a phrase edited since it was embedded, another model, or when off", () => {
      expect(codes(scoreMatch(vendor(), record([0, 1]), none, on, "2026-01-01"))).not.toContain("free-text-meaning");
      expect(codes(scoreMatch(vendor({ otherCategories: ["งานอื่น"] }), record([0.9, 0.1]), none, on, "2026-01-01"))).not.toContain("free-text-meaning");
      expect(codes(scoreMatch(vendor(), record([0.9, 0.1], "other-model"), none, on, "2026-01-01"))).not.toContain("free-text-meaning");
      expect(codes(scoreMatch(vendor(), record([0.9, 0.1]), none, config, "2026-01-01"))).not.toContain("free-text-meaning");
    });
  });

  describe("area signal (TOR-313)", () => {
    const on = { ...config, matching: { ...config.matching, areaSignalEnabled: true } };
    const located = (value: string, verified = true) => tor({ fields: { budget: { raw: "150", value: 150, confidence: 1, verified: true }, deadline: { value: "2027-01-01" }, workLocation: { raw: value, value, confidence: 1, verified } } });
    const serving = (areas: string[]) => ({ ...profile(), areas });

    it("scores a TOR in a served province higher than one outside, and says why", () => {
      const inside = scoreMatch(serving(["khon-kaen"]), located("จ.ขอนแก่น"), classification, on, "2026-01-01");
      const outside = scoreMatch(serving(["phuket"]), located("จ.ขอนแก่น"), classification, on, "2026-01-01");
      expect(inside.score).toBeGreaterThan(outside.score);
      expect(inside.reasons).toContainEqual(expect.objectContaining({ code: "area-inside" }));
      expect(outside.reasons).toContainEqual(expect.objectContaining({ code: "area-outside" }));
    });

    it("stays silent for a whole-country vendor, an unverified location, one naming no province, or the switch off", () => {
      const codes = (result: ReturnType<typeof scoreMatch>) => result.reasons.map((reason) => reason.code);
      expect(codes(scoreMatch(serving([WHOLE_COUNTRY_AREA]), located("จ.ขอนแก่น"), classification, on, "2026-01-01"))).not.toContain("area-inside");
      expect(codes(scoreMatch(serving(["khon-kaen"]), located("จ.ขอนแก่น", false), classification, on, "2026-01-01"))).not.toContain("area-inside");
      expect(codes(scoreMatch(serving(["khon-kaen"]), located("อาคาร ชั้น 3"), classification, on, "2026-01-01")).some((code) => code.startsWith("area"))).toBe(false);
      expect(codes(scoreMatch(serving(["khon-kaen"]), located("จ.ขอนแก่น"), classification, config, "2026-01-01")).some((code) => code.startsWith("area"))).toBe(false);
    });
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

  describe("certifications a TOR names", () => {
    const withQualifications = (...lines: string[]) => tor({ fields: { ...tor().fields, qualifications: { raw: lines.join(" "), value: lines, confidence: 1, verified: true } } });
    const holding = (tags: string[], other: string[] = []) => ({ ...profile(), certifications: { cgd: [], tags, other } });
    const codes = (result: { reasons: Array<{ code: string }> }) => result.reasons.map((reason) => reason.code);

    it("lifts a vendor who holds what the TOR names above one who does not, and says which", () => {
      const named = withQualifications("ต้องได้รับการรับรองมาตรฐาน ISO 9001");
      const held = scoreMatch(holding(["iso-9001"]), named, classification, config, "2026-01-01");
      const missing = scoreMatch(holding([]), named, classification, config, "2026-01-01");
      expect(held.score).toBeGreaterThan(missing.score);
      expect(held.reasons.find((r) => r.code === "qualification-held")?.th).toContain("ISO 9001");
      expect(missing.reasons.find((r) => r.code === "qualification-missing")?.th).toContain("ISO 9001");
    });

    it("counts either one as enough when the TOR says หรือ", () => {
      const either = withQualifications("ได้รับการรับรองมาตรฐาน ISO 9001 และ/หรือ ISO 14001");
      const one = scoreMatch(holding(["iso-14001"]), either, classification, config, "2026-01-01");
      const both = scoreMatch(holding(["iso-9001", "iso-14001"]), either, classification, config, "2026-01-01");
      expect(one.score).toBeCloseTo(both.score);
      expect(codes(one)).toContain("qualification-held");
    });

    it("counts a vendor's own free-text certification when the TOR uses their words", () => {
      const named = withQualifications("ต้องมีใบอนุญาตประกอบกิจการโรงงาน");
      expect(codes(scoreMatch(holding([], ["ใบอนุญาตประกอบกิจการโรงงาน"]), named, classification, config, "2026-01-01"))).toContain("qualification-held");
    });

    describe("held by the staff", () => {
      const withStaff = (certs: string[][], tags?: string[]) => ({
        ...profile(),
        ...(tags ? { certifications: { cgd: [], tags, other: [] } } : {}),
        personnel: certs.map((certifications, i) => ({ id: `p${i}`, role: `ตำแหน่ง ${i}`, certifications, other: [] })),
      });
      const engineer = withQualifications("ผู้ยื่นข้อเสนอต้องมีวิศวกรผู้ถือใบอนุญาตประกอบวิชาชีพวิศวกรรมควบคุม");

      it("counts a certificate a member of staff holds, and names it as the staff's", () => {
        const held = scoreMatch(withStaff([["engineer"]], []), engineer, classification, config, "2026-01-01");
        const none = scoreMatch(withStaff([[]], []), engineer, classification, config, "2026-01-01");
        expect(held.score).toBeGreaterThan(none.score);
        expect(held.reasons.find((r) => r.code === "qualification-held")?.th).toContain("(บุคลากร)");
        expect(none.reasons.find((r) => r.code === "qualification-missing")?.th).toContain("ใบอนุญาตวิศวกร");
      });

      it("adds the company's and the staff's certificates together", () => {
        const both = withQualifications("ISO 9001 และใบอนุญาตประกอบวิชาชีพวิศวกรรมควบคุม");
        const result = scoreMatch(withStaff([["engineer"]], ["iso-9001"]), both, classification, config, "2026-01-01");
        expect(result.reasons.map((r) => r.code)).toContain("qualification-held");
        expect(result.reasons.map((r) => r.code)).not.toContain("qualification-missing");
        expect(result.reasons.find((r) => r.code === "qualification-held")?.th).toMatch(/ISO 9001.*วิศวกร.*\(บุคลากร\)/);
      });

      it("does not mark the company as missing a certificate it never stated, when only staff were listed", () => {
        const both = withQualifications("ISO 9001 และใบอนุญาตประกอบวิชาชีพวิศวกรรมควบคุม");
        const result = scoreMatch(withStaff([["engineer"]]), both, classification, config, "2026-01-01");
        expect(result.reasons.map((r) => r.code)).not.toContain("qualification-missing");
        // Nothing the staff hold is named: the signal stays out rather than lowering the score.
        const other = scoreMatch(withStaff([["architect"]]), withQualifications("ISO 9001"), classification, config, "2026-01-01");
        expect(other.reasons.map((r) => r.code)).not.toContain("qualification-missing");
        expect(other.score).toBeCloseTo(scoreMatch(profile(), withQualifications("ISO 9001"), classification, config, "2026-01-01").score);
      });
    });

    it("stays out of the score until the vendor has stated what they hold, and when the TOR names nothing", () => {
      const named = withQualifications("ต้องได้รับการรับรองมาตรฐาน ISO 9001");
      const plain = scoreMatch(profile(), tor(), classification, config, "2026-01-01");
      expect(scoreMatch(profile(), named, classification, config, "2026-01-01").score).toBeCloseTo(plain.score);
      expect(scoreMatch(holding([]), tor(), classification, config, "2026-01-01").score).toBeCloseTo(plain.score);
    });
  });
});

