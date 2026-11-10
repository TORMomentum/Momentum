import { CERTIFICATIONS, CGD_BRANCHES, PROVINCES, WHOLE_COUNTRY_AREA, WORK_CATEGORIES, WORK_CATEGORY_LEAVES, readinessOf } from "@tor-radar/seeds";
import type { RequiredDocument } from "@tor-radar/shared";
import type { VendorProfileDocument } from "../../core/db.js";
import { AppError } from "../../core/errors.js";
import { GenerationError, type TextGenerator } from "../../ports/text-generator.port.js";
import type { ProfileRepository } from "../profile/profile.repository.js";
import type { VaultRepository } from "../vault/vault.repository.js";
import { buildDraftPrompt, DRAFT_SYSTEM_PROMPT, type DraftFacts } from "./drafts.prompt.js";

type PublicField = { raw: string; value: unknown } | undefined;
/** What `TorsService.detail` gives: the redacted public record, and NotFoundError when there is none. */
export interface TorReader {
  detail(id: string): Promise<{ fields: Partial<Record<string, PublicField>> }>;
}

const THAI_NAME = new Map<string, string>([
  ...CERTIFICATIONS.map((item) => [item.id, item.th] as const),
  ...CGD_BRANCHES.map((item) => [item.id, item.th] as const),
  ...PROVINCES.map((item) => [item.id, item.th] as const),
  ...WORK_CATEGORIES.map((item) => [item.id, item.th] as const),
  ...WORK_CATEGORY_LEAVES.map((item) => [item.id, item.th] as const),
  [WHOLE_COUNTRY_AREA, "ทั่วประเทศ"],
]);
const named = (ids: string[]) => ids.map((id) => THAI_NAME.get(id) ?? id);

function documentsOf(value: unknown): RequiredDocument[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RequiredDocument => typeof item?.name === "string" && ["company", "personnel", "unspecified"].includes(item?.holder));
}

function profileFacts(profile: VendorProfileDocument): DraftFacts["profile"] {
  const held = profile.certifications;
  return {
    categories: [...named(profile.categories), ...(profile.otherCategories ?? [])],
    areas: named(profile.areas),
    certifications: held
      ? [...named(held.tags), ...held.cgd.map((entry) => `${THAI_NAME.get(entry.branch) ?? entry.branch}${entry.grade ? ` ชั้น ${entry.grade}` : ""}`), ...held.other]
      : [],
    // By role only; a person's name is never stored, and nothing about them is sent beyond what they hold.
    personnel: (profile.personnel ?? []).map((member) => [member.role, ...named(member.certifications), ...member.other].join(" — ")),
    pastProjects: (profile.pastProjects ?? []).map(({ title, year, valueThb }) => ({ title, year, valueThb })),
  };
}

export interface Draft {
  text: string;
  modelVersion: string;
  generatedAt: string;
}

/**
 * A cover letter for one TOR, drafted by the model from the vendor's own profile and the TOR's extracted fields
 * (TOR-220). It sends the NAMES of the kept files, never their contents, and stores nothing: the draft exists
 * only in the response. The vendor reviews and confirms it before it leaves the page, and nothing is ever
 * submitted for them.
 */
export class DraftsService {
  constructor(
    private readonly deps: { tors: TorReader; profiles: ProfileRepository; vault: VaultRepository; generator: TextGenerator; now?: () => Date },
  ) {}

  async draft(accountId: string, torId: string): Promise<Draft> {
    const record = await this.deps.tors.detail(torId); // NotFoundError for an unknown, restricted or unpublished TOR
    const profile = await this.deps.profiles.findByAccountId(accountId);
    if (!profile?.categories.length) throw new AppError(409, "profile_needed", "กรุณากรอกโปรไฟล์ (งานที่รับ) ก่อนให้ AI ร่างจดหมาย");

    const { fields } = record;
    const text = (name: string) => fields[name]?.raw ?? "";
    const qualifications = fields.qualifications?.value;
    const files = await this.deps.vault.list(accountId);
    const documents = readinessOf(documentsOf(fields.requiredDocuments?.value), files).map((row) => ({
      name: row.document.name,
      holder: row.document.holder,
      status: row.status,
      ...(row.status === "have" ? { filename: row.file.filename } : {}),
    }));
    const facts: DraftFacts = {
      tor: {
        title: text("title"), agency: text("agency"), referenceNo: text("referenceNo"), deadline: text("deadline"), scope: text("scopeSummary"),
        qualifications: Array.isArray(qualifications) ? qualifications.filter((item): item is string => typeof item === "string") : [],
      },
      profile: profileFacts(profile),
      documents,
    };

    try {
      const { text: letter, modelVersion } = await this.deps.generator.generate({ system: DRAFT_SYSTEM_PROMPT, prompt: buildDraftPrompt(facts) });
      return { text: letter, modelVersion, generatedAt: (this.deps.now ?? (() => new Date()))().toISOString() };
    } catch (error) {
      if (!(error instanceof GenerationError)) throw error;
      // The reason, never the prompt: it holds the vendor's data.
      console.warn(JSON.stringify({ event: "draft_failed", reason: error.message }));
      throw new AppError(502, "draft_failed", "AI ร่างจดหมายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
  }
}
