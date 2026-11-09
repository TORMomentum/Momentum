import { CGD_BRANCHES, PERSONAL_CERTIFICATION_IDS, PROVINCES, WHOLE_COUNTRY_AREA, WORK_CATEGORY_LEAVES } from "@tor-radar/seeds";
import type { Config } from "../../core/config.js";
import type { TorDocument, VendorProfileDocument } from "../../core/db.js";
import { provincesIn } from "../../lib/province.js";
import { cosine } from "../../ports/embeddings.port.js";
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
  return semanticSignal(profile, record, config);
}

const provinceName = new Map<string, string>(PROVINCES.map((province) => [province.id, province.th]));

/**
 * Whether the work is where the vendor serves. Silent unless the extracted work
 * location is verified and names a province, and silent for a vendor serving
 * the whole country: an unknown place is never scored, and an agency's address
 * is never a stand-in for it.
 */
function areaSignal(profile: VendorProfileDocument, record: TorDocument) {
  const location = record.fields.workLocation;
  if (!location?.verified || typeof location.value !== "string") return null;
  const areas = profile.areas ?? [];
  if (areas.length === 0 || areas.includes(WHOLE_COUNTRY_AREA)) return null;
  const provinces = provincesIn(location.value);
  if (provinces.length === 0) return null;
  const name = provinceName.get(provinces[0]!) ?? provinces[0]!;
  return provinces.some((id) => areas.includes(id))
    ? { score: 1, reason: { code: "area-inside", th: `งานอยู่ในพื้นที่ที่คุณให้บริการ: ${name}` } }
    : { score: 0, reason: { code: "area-outside", th: `งานอยู่นอกพื้นที่ที่คุณให้บริการ: ${name}` } };
}

/**
 * A phrase the vendor wrote, matched to the TOR by meaning when no word of it
 * appears. Both vectors were made before scoring, by the same model; a phrase
 * edited since (its text no longer matches) or made by another model is ignored.
 */
function semanticSignal(profile: VendorProfileDocument, record: TorDocument, config: Config) {
  const embedding = record.embedding;
  if (!config.embeddings.enabled || !embedding) return { score: 0, reason: null };
  const current = new Set((profile.otherCategories ?? []).map((entry) => entry.trim()));
  let best: { text: string; similarity: number } | null = null;
  for (const entry of profile.otherCategoryVectors ?? []) {
    if (entry.model !== embedding.model || !current.has(entry.text.trim())) continue;
    const similarity = cosine(entry.vector, embedding.vector);
    if (similarity >= config.embeddings.minSimilarity && (!best || similarity > best.similarity)) best = { text: entry.text, similarity };
  }
  return best
    ? { score: config.matching.freeTextScore, reason: { code: "free-text-meaning", th: `ความหมายใกล้เคียงกับงานที่คุณระบุเอง: ${best.text}` } }
    : { score: 0, reason: null };
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
  // Personnel stated counts as stating something: TORs mostly ask for people, not ISO (TOR-212).
  // Only a licence to practise can be held by a person; the company's ISO is not satisfied by an employee having it.
  const personal = new Set<string>(PERSONAL_CERTIFICATION_IDS);
  const staff = new Set((profile.personnel ?? []).flatMap((member) => member.certifications).filter((id) => personal.has(id)));
  if (!profile.certifications && staff.size === 0) return null;
  const text = qualificationText(record);
  const company = new Set(profile.certifications?.tags ?? []);
  const ownWords = (profile.certifications?.other ?? []).filter((entry) => entry.trim().length > 1 && text.includes(entry.trim()));
  // Staff alone cannot show the company lacks a certificate it never said anything about.
  const mentioned = certificationsMentioned(text).filter((id) => profile.certifications || staff.has(id));
  if (mentioned.length === 0 && ownWords.length === 0) return null;
  const held = mentioned.filter((id) => company.has(id) || staff.has(id));
  const missing = mentioned.filter((id) => !held.includes(id));
  // A certificate only the staff hold is named as theirs, so the vendor sees why it counted.
  const heldNames = [...held.map((id) => (company.has(id) ? certificationName(id) : `${certificationName(id)} (บุคลากร)`)), ...ownWords];
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
  // Off until the work-location field has been checked against real TORs.
  if (config.matching.areaSignalEnabled) {
    const area = areaSignal(profile, record);
    if (area) signals.push({ weight: config.matching.areaWeight, signal: area });
  }
  const totalWeight = signals.reduce((total, item) => total + item.weight, 0);
  const weighted = signals.reduce((total, item) => total + item.weight * item.signal.score, 0) / totalWeight;
  const registration = registrationCheck(profile, record, classification, config);
  const reasons = signals.flatMap((item) => item.signal.reason ? [item.signal.reason] : []);
  // A missing registration is the first thing a vendor needs to know, so it leads.
  if (registration?.factor !== undefined && registration.factor < 1) reasons.unshift(registration.reason);
  else if (registration) reasons.push(registration.reason);
  return { score: weighted * (registration?.factor ?? 1), reasons, excluded: null };
}
