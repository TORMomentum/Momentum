import { WORK_CATEGORY_LEAVES } from "@tor-radar/seeds";
import type { Config } from "../../core/config.js";
import type { TorDocument, VendorProfileDocument } from "../../core/db.js";
import type { TorClassification } from "./tor-classifier.js";

export type MatchResult = { score: number; reasons: Array<{ code: string; th: string }>; excluded: null | { code: string; th: string } };
const leafById = new Map(WORK_CATEGORY_LEAVES.map((leaf) => [leaf.id, leaf]));

function profileCoarseCategories(profile: VendorProfileDocument): Set<string> {
  const selected = new Set(profile.categories);
  return new Set(WORK_CATEGORY_LEAVES.filter((leaf) => selected.has(leaf.id) || selected.has(leaf.groupId)).flatMap((leaf) => leaf.torCategories));
}

function categorySignal(profile: VendorProfileDocument, classification: TorClassification, config: Config) {
  for (const leaf of classification.leaves) if (profile.categories.includes(leaf.id)) return { score: config.matching.categoryLeafScore, reason: { code: "category-leaf", th: `ตรงกับหมวดงานที่คุณเลือก: ${leafById.get(leaf.id)?.th ?? leaf.id}` } };
  for (const leaf of classification.leaves) {
    const groupId = leafById.get(leaf.id)?.groupId;
    if (groupId && profile.categories.includes(groupId)) return { score: config.matching.categoryGroupScore, reason: { code: "category-group", th: `อยู่ในหมวดงานที่คุณเลือก: ${leafById.get(leaf.id)?.th ?? leaf.id}` } };
  }
  if (classification.coarse && profileCoarseCategories(profile).has(classification.coarse)) return { score: config.matching.categoryCoarseScore, reason: { code: "category-coarse", th: "อยู่ในหมวดจัดซื้อจัดจ้างที่เกี่ยวข้องกับงานที่คุณเลือก" } };
  return { score: 0, reason: null };
}

function freeTextSignal(profile: VendorProfileDocument, record: TorDocument, config: Config) {
  const text = [record.fields.title?.value ?? record.fields.title?.raw, record.fields.scopeSummary?.value ?? record.fields.scopeSummary?.raw].filter((value): value is string => typeof value === "string").join("\n").toLocaleLowerCase("th-TH");
  for (const entry of profile.otherCategories ?? []) {
    const query = entry.trim(); if (!query) continue;
    const terms = [query, ...query.split(/[\s,;/|]+/u).filter((part) => part.length > 1)].map((term) => term.toLocaleLowerCase("th-TH"));
    if (terms.some((term) => text.includes(term))) return { score: config.matching.freeTextScore, reason: { code: "free-text", th: `คล้ายกับงานที่คุณระบุเอง: ${query}` } };
  }
  return { score: 0, reason: null };
}

function budgetSignal(profile: VendorProfileDocument, record: TorDocument, config: Config) {
  const budget = record.fields.budget?.value;
  if (!profile.budget || typeof budget !== "number") return { score: config.matching.budgetNeutralScore, reason: { code: "budget-neutral", th: "ยังไม่มีข้อมูลงบประมาณเพียงพอสำหรับเปรียบเทียบกับช่วงที่คุณระบุ" } };
  const { minThb, maxThb } = profile.budget;
  if (budget >= minThb && budget <= maxThb) return { score: config.matching.budgetInsideScore, reason: { code: "budget-inside", th: "งบประมาณอยู่ในช่วงที่คุณระบุ" } };
  const distance = budget < minThb ? minThb - budget : budget - maxThb;
  const span = Math.max(maxThb - minThb, Number.EPSILON);
  return { score: Math.max(0, config.matching.budgetOutsideMaxScore * (1 - distance / (span * config.matching.budgetDistanceRangeMultiplier))), reason: { code: "budget-outside", th: "งบประมาณอยู่นอกช่วงที่คุณระบุ จึงลดคะแนนความเกี่ยวข้อง" } };
}

export function scoreMatch(profile: VendorProfileDocument, record: TorDocument, classification: TorClassification, config: Config, today: string): MatchResult {
  const deadline = record.fields.deadline?.value;
  if (typeof deadline === "string" && deadline < today) return { score: 0, reasons: [], excluded: { code: "deadline-passed", th: "ปิดรับข้อเสนอแล้ว" } };
  if (record.access.restricted) return { score: 0, reasons: [], excluded: { code: "restricted", th: "รายการนี้ถูกจำกัดการเข้าถึง" } };
  const taxonomy = categorySignal(profile, classification, config);
  const freeText = freeTextSignal(profile, record, config);
  // A taxonomy hit remains stronger than an unstructured phrase, even when both match.
  const relevance = taxonomy.score > 0 ? taxonomy : freeText;
  const budget = budgetSignal(profile, record, config);
  const signals = [{ weight: config.matching.categoryWeight, signal: relevance }, { weight: config.matching.budgetWeight, signal: budget }];
  // Work location is not extracted yet. This switch prevents an agency address
  // ever becoming a proxy for it; turn it on with the future extracted field.
  if (config.matching.areaSignalEnabled) { /* location signal belongs here once extracted */ }
  const totalWeight = signals.reduce((total, item) => total + item.weight, 0);
  return { score: signals.reduce((total, item) => total + item.weight * item.signal.score, 0) / totalWeight, reasons: signals.flatMap((item) => item.signal.reason ? [item.signal.reason] : []), excluded: null };
}
