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
});
