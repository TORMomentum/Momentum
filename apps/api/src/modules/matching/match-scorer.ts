import { CGD_BRANCHES, WORK_CATEGORY_LEAVES } from "@tor-radar/seeds";
import type { Config } from "../../core/config.js";
import type { TorDocument, VendorProfileDocument } from "../../core/db.js";
import { certificationName, certificationsMentioned, qualificationText } from "./certifications.js";
import { cgdBranchOf } from "./registration.js";
import { classifyTor, type TorClassification } from "./tor-classifier.js";

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

/**
 * Each past project's kinds of work, classified the way TORs are. Memoised per
 * profile object: one request scores a couple of hundred candidates against
 * the same profile, and classifying every project for every candidate would
 * multiply the classifier's cost by both.
 */
const projectLeavesCache = new WeakMap<VendorProfileDocument, Array<{ title: string; leaves: Set<string> }>>();
function projectLeaves(profile: VendorProfileDocument, config: Config) {
  let cached = projectLeavesCache.get(profile);
  if (!cached) {
    cached = (profile.pastProjects ?? []).map((project) => ({
      title: project.title,
      leaves: new Set(classifyTor({ fields: { title: { raw: project.title, value: project.title, confidence: 1, verified: true } } } as Pick<TorDocument, "fields">, config).leaves.map((leaf) => leaf.id)),
    })).filter((project) => project.leaves.size > 0);
    projectLeavesCache.set(profile, cached);
  }
  return cached;
}

/** Null when the vendor has listed no classifiable past work: the signal then stays out of the score entirely. */
function experienceSignal(profile: VendorProfileDocument, classification: TorClassification, config: Config) {
  const projects = projectLeaves(profile, config);
  if (projects.length === 0) return null;
  const torLeaves = classification.leaves.map((leaf) => leaf.id);
  const similar = projects.find((project) => torLeaves.some((leaf) => project.leaves.has(leaf)));
  return similar
    ? { score: 1, reason: { code: "experience", th: `คล้ายกับผลงานที่คุณเคยทำ: ${similar.title}` } }
    : { score: 0, reason: null };
}

/**
 * The certifications a TOR names against what the vendor holds. Null — out of
 * the score — unless the TOR names one and the vendor has stated what they
 * hold. Worded "A หรือ B", holding either is enough; otherwise the score is
 * the share held. A vendor's own free-text certification counts as held when
 * the TOR uses their words.
 */
function qualificationSignal(profile: VendorProfileDocument, record: TorDocument) {
  if (!profile.certifications) return null;
  const text = qualificationText(record);
  const mentioned = certificationsMentioned(text);
  const ownWords = profile.certifications.other.filter((entry) => entry.trim().length > 1 && text.includes(entry.trim()));
  if (mentioned.length === 0 && ownWords.length === 0) return null;
  const held = mentioned.filter((id) => profile.certifications!.tags.includes(id));
  const missing = mentioned.filter((id) => !held.includes(id));
  const heldNames = [...held.map(certificationName), ...ownWords];
  const either = /หรือ/.test(text) && heldNames.length > 0;
  const score = either || missing.length === 0 ? 1 : held.length / mentioned.length;
  const reason = missing.length > 0 && !either
    ? { code: "qualification-missing", th: `TOR นี้ระบุ ${missing.map(certificationName).join(", ")} ซึ่งคุณยังไม่ได้ระบุ` }
    : { code: "qualification-held", th: `คุณมี ${heldNames.join(", ")} ที่ TOR นี้ระบุ` };
  return { score, reason };
}

const branchName = new Map<string, string>(CGD_BRANCHES.map((branch) => [branch.id, branch.th]));

/**
 * หนังสือ ว642: a construction TOR at or above the threshold needs a กรมบัญชีกลาง
 * registration in its branch. Applied only once the vendor has stated what
 * they hold — an empty section means "not told yet", not "holds nothing".
 */
function registrationCheck(profile: VendorProfileDocument, record: TorDocument, classification: TorClassification, config: Config) {
  const budget = record.fields.budget?.value;
  if (!profile.certifications || typeof budget !== "number" || budget < config.matching.registrationMinBudgetThb) return null;
  const branch = cgdBranchOf(record, classification);
  if (!branch) return null;
  const name = branchName.get(branch) ?? branch;
  return profile.certifications.cgd.some((held) => held.branch === branch)
    ? { factor: 1, reason: { code: "registration-held", th: `คุณขึ้นทะเบียนกรมบัญชีกลางสาขา${name} ตามที่งานขนาดนี้กำหนด` } }
    : { factor: config.matching.registrationMissingFactor, reason: { code: "registration-missing", th: `งานขนาดนี้ต้องขึ้นทะเบียนกรมบัญชีกลางสาขา${name} ซึ่งคุณยังไม่ได้ระบุ` } };
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
  const experience = experienceSignal(profile, classification, config);
  if (experience) signals.push({ weight: config.matching.experienceWeight, signal: experience });
  const qualification = qualificationSignal(profile, record);
  if (qualification) signals.push({ weight: config.matching.qualificationWeight, signal: qualification });
  // Work location is not extracted yet. This switch prevents an agency address
  // ever becoming a proxy for it; turn it on with the future extracted field.
  if (config.matching.areaSignalEnabled) { /* location signal belongs here once extracted */ }
  const totalWeight = signals.reduce((total, item) => total + item.weight, 0);
  const weighted = signals.reduce((total, item) => total + item.weight * item.signal.score, 0) / totalWeight;
  const registration = registrationCheck(profile, record, classification, config);
  const reasons = signals.flatMap((item) => item.signal.reason ? [item.signal.reason] : []);
  // A missing registration is the first thing a vendor needs to know, so it leads.
  if (registration?.factor !== undefined && registration.factor < 1) reasons.unshift(registration.reason);
  else if (registration) reasons.push(registration.reason);
  return { score: weighted * (registration?.factor ?? 1), reasons, excluded: null };
}
