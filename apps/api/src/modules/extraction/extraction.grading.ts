import type { ConfidenceLevel, ExtractedField, TorFields } from "@tor-radar/shared";
import type { RawExtraction, RawField } from "../../ports/ai.port.js";
import { mapQualifications } from "./extraction.taxonomy.js";

export interface GradingContext {
  /** Digital PDF text layer vs an OCR'd scan/photo (spec D6). */
  hasTextLayer: boolean;
  /** The TOR's own publication date, from `raw.announcementDate`, or null. */
  announcedAt: Date | null;
  tLow: number;
  tHigh: number;
  budgetMinThb: number;
  budgetMaxThb: number;
  /**
   * Fields the source system already stated (`origin: "source"`, e.g. from the
   * BMA e-GP API). They are trusted as given: they pass their checks, count as
   * verified, and are written back unchanged — whatever the model read.
   */
  knownFields?: Partial<TorFields>;
}

export interface GradingResult {
  fields: TorFields;
  confidenceLevel: ConfidenceLevel;
  unverified: boolean;
  /**
   * Why this record needs a human, as machine-readable reasons (FR-G-1). The
   * checks that produced them ran here, so recording them here is the only
   * place they are known - a reviewer opening the queue would otherwise have to
   * re-derive them by eye.
   */
  reviewReasons: string[];
}

/**
 * The critical fields whose absence makes a record "low" (§4.2.1). `deadline` is
 * NOT one: most Thai draft TORs state no submission date - it lives in the paired
 * ประกาศ - so treating a missing deadline as a queue trigger would send almost
 * every real record to review (spec §10 Q3, resolved against the TOR-18 corpus).
 * A deadline that is present but *implausible* still trips a Pass-3 check.
 */
const CRITICAL = ["agency", "budget"] as const;

const SCOPE_MIN_CHARS = 40;

function isValidDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pass 1: does the field's own shape hold, before the model's confidence is looked at? */
function structurallyOk(name: keyof TorFields, raw: RawExtraction, ctx: GradingContext): boolean {
  switch (name) {
    case "agency":
    case "title":
    case "category":
      return raw[name].value !== null && String(raw[name].value).trim() !== "";
    case "budget": {
      const v = raw.budget.value;
      return v !== null && v >= ctx.budgetMinThb && v <= ctx.budgetMaxThb && ctx.hasTextLayer;
    }
    case "deadline": {
      const d = isValidDate(raw.deadline.value);
      if (!d || !ctx.hasTextLayer) return false;
      return ctx.announcedAt === null || d.getTime() >= ctx.announcedAt.getTime();
    }
    case "torStatus":
      return raw.status.value !== null;
    case "scopeSummary":
      return (raw.scopeSummary.value ?? "").trim().length >= SCOPE_MIN_CHARS;
    case "qualifications":
      // FR-B-4: usable only if at least one qualification maps to a taxonomy tag.
      return mapQualifications(raw.qualifications.value).length >= 1;
    case "contact":
      // No structural gate (§6): `verified` on contact tracks display confidence only,
      // and contact never feeds the anomaly rule or matching.
      return raw.contact.value !== null;
    default:
      // procurementMethod / referenceNo are never verified-gated.
      return false;
  }
}

type RawKey = Exclude<keyof RawExtraction, "modelVersion">;

const RAW_TO_TOR: Record<keyof TorFields, RawKey> = {
  title: "title",
  agency: "agency",
  budget: "budget",
  category: "category",
  scopeSummary: "scopeSummary",
  qualifications: "qualifications",
  deadline: "deadline",
  contact: "contact",
  torStatus: "status",
  procurementMethod: "procurementMethod",
  referenceNo: "referenceNo",
};

/** The RawField for a TorFields key, typed loosely (its own T is not needed here). */
function rawFor(raw: RawExtraction, name: keyof TorFields): RawField<unknown> {
  return raw[RAW_TO_TOR[name]] as RawField<unknown>;
}

function buildField<T>(rf: RawField<T>, verified: boolean, extra: Partial<ExtractedField<T>> = {}): ExtractedField<T> {
  return { raw: rf.raw, value: rf.value, confidence: rf.confidence, verified, evidence: rf.evidence, ...extra };
}

/**
 * SRS §4.2.1 realised. Deterministic per-field checks first (Pass 1), the model's
 * self-confidence only as a secondary gate inside the band those checks allow
 * (Pass 2), then record-level sanity checks (Pass 3). BENCHMARK.md: the model's
 * confidence does not by itself separate right answers from wrong ones.
 */
export function grade(modelRaw: RawExtraction, ctx: GradingContext): GradingResult {
  const known = ctx.knownFields ?? {};
  const isKnown = (name: keyof TorFields) => known[name] !== undefined;

  // A stated value stands in for the model's reading everywhere below, so the
  // sanity checks judge what will actually be published.
  const raw: RawExtraction = { ...modelRaw };
  for (const name of Object.keys(known) as (keyof TorFields)[]) {
    const field = known[name];
    if (!field) continue;
    (raw as unknown as Record<string, RawField<unknown>>)[RAW_TO_TOR[name]] = {
      raw: field.raw,
      value: field.value,
      confidence: 1,
      evidence: "",
    };
  }

  const structOk = {} as Record<keyof TorFields, boolean>;
  for (const name of Object.keys(RAW_TO_TOR) as (keyof TorFields)[]) {
    structOk[name] = isKnown(name) || structurallyOk(name, raw, ctx);
  }

  const verifiedOf = (name: keyof TorFields): boolean => {
    if (isKnown(name)) return true;
    const conf = rawFor(raw, name).confidence;
    return structOk[name] && conf >= ctx.tHigh;
  };

  const fields: TorFields = {
    title: buildField(raw.title, verifiedOf("title")),
    agency: buildField(raw.agency, verifiedOf("agency")),
    budget: buildField(raw.budget, verifiedOf("budget"), { currency: "THB" }),
    category: buildField(raw.category, verifiedOf("category")),
    scopeSummary: buildField(raw.scopeSummary, verifiedOf("scopeSummary")),
    qualifications: buildField(raw.qualifications, verifiedOf("qualifications"), {
      tags: mapQualifications(raw.qualifications.value),
    }),
    deadline: buildField(raw.deadline, verifiedOf("deadline")),
    contact: buildField(raw.contact, verifiedOf("contact")),
    torStatus: buildField(raw.status, verifiedOf("torStatus")),
    procurementMethod: buildField(raw.procurementMethod, false),
    referenceNo: buildField(raw.referenceNo, false),
  };

  // Written back exactly as the source stated them, origin and all.
  for (const name of Object.keys(known) as (keyof TorFields)[]) {
    if (known[name]) (fields as unknown as Record<string, unknown>)[name] = known[name];
  }

  // --- Pass 3: sanity (FR-B-3 "a critical field missing or implausible"; TOR-91) ---
  const sanity: string[] = [];

  for (const c of CRITICAL) {
    const rf = rawFor(raw, c);
    if (rf.value === null || rf.confidence < ctx.tLow) sanity.push(`${c}-missing`);
  }
  if (raw.budget.value !== null && (raw.budget.value < ctx.budgetMinThb || raw.budget.value > ctx.budgetMaxThb)) {
    sanity.push("budget-implausible");
  }
  const deadline = isValidDate(raw.deadline.value);
  if (deadline && ctx.announcedAt && deadline.getTime() < ctx.announcedAt.getTime()) {
    sanity.push("deadline-before-announcement");
  }
  // A closed or awarded TOR legitimately HAS a submission deadline - that is what
  // closed means - so the presence of one is not a signal. What is a signal is a
  // deadline still in the future on a record that says the procurement is over,
  // which is the benchmark's hallucination signature. Cancellation notices state
  // no deadline at all, so any deadline on one stays suspect.
  const statusValue = raw.status.value;
  const finished = statusValue === "closed" || statusValue === "awarded";
  const deadlineDate = isValidDate(raw.deadline.value);
  if (statusValue === "cancelled" && raw.deadline.value !== null) {
    sanity.push("cancelled-with-deadline");
  } else if (finished && deadlineDate && deadlineDate.getTime() > Date.now()) {
    sanity.push("closed-with-future-deadline");
  }
  const rawCounts = new Map<string, number>();
  for (const name of Object.keys(RAW_TO_TOR) as (keyof TorFields)[]) {
    // Copy-through is a model failure; a value the source stated is not one.
    if (isKnown(name)) continue;
    const r = rawFor(raw, name).raw.trim();
    if (r) rawCounts.set(r, (rawCounts.get(r) ?? 0) + 1);
  }
  if ([...rawCounts.values()].some((n) => n >= 3)) sanity.push("copy-through");

  // --- record level ---
  const criticalStructFailed = CRITICAL.some((c) => !structOk[c]);
  const allCriticalVerified = CRITICAL.every((c) => verifiedOf(c));

  let confidenceLevel: ConfidenceLevel;
  if (sanity.length > 0 || criticalStructFailed) confidenceLevel = "low";
  else if (allCriticalVerified) confidenceLevel = "high";
  else confidenceLevel = "medium";

  // Structural failures are reasons too: "no readable budget" is what a
  // reviewer needs to see, not just a confidence number.
  const reasons = [...sanity];
  for (const c of CRITICAL) {
    if (!structOk[c] && !reasons.includes(`${c}-missing`)) reasons.push(`${c}-unreadable`);
  }

  return {
    fields,
    confidenceLevel,
    unverified: confidenceLevel !== "high",
    reviewReasons: confidenceLevel === "low" ? reasons : [],
  };
}
