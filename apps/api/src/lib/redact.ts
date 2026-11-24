import type { AwardResult, ExtractedField, TorRecord } from "@tor-radar/shared";

/**
 * FR-B-5 / NFR-S2: minimise personal data in anything shown publicly. The one
 * place redaction happens, so no serializer or export can forget it (Slice-1
 * §4.7). It reduces `fields.contact` - an office name, an office landline, and a
 * government URL are kept; a personal name, a mobile number, an email address,
 * and a signature line are removed. The stored original stays reachable through
 * its source link regardless (NFR-S3).
 *
 * This is minimisation, not anonymisation: it strips the parts that identify an
 * individual, not every trace of a person.
 */

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Thai mobile numbers start 06 / 08 / 09 and have 10 digits; separators vary.
// Office landlines (0 2xxx xxxx) are kept, so the leading "02" is excluded.
const MOBILE = /\b0[689][\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d\b/g;

// A person named in a signature or a "contact: <name>" line.
const PERSON_NAME =
  /(?:นาย|นาง|นางสาว|ว่าที่ร้อย[ตท]\S*|ดร\.|ผู้ช่วย|ผู้อำนวยการเขต\S*)\s*[ก-๙A-Za-z.]+(?:\s+[ก-๙A-Za-z.]+){0,2}/g;

// A parenthetical signature: "(นายอนุรัตน์ เครือชะเอม)".
const PAREN_NAME = /\((?:นาย|นาง|นางสาว|ว่าที่|ดร\.)[^)]*\)/g;

function redactContactString(text: string): string {
  return text
    .replace(EMAIL, "")
    .replace(PAREN_NAME, "")
    .replace(MOBILE, "")
    .replace(PERSON_NAME, "")
    .replace(/\s*[;,·]\s*(?=[;,·]|$)/g, "") // tidy separators left dangling
    .replace(/\s{2,}/g, " ")
    .trim();
}

function redactField(field: ExtractedField | undefined): ExtractedField | undefined {
  if (!field) return field;
  return {
    ...field,
    raw: redactContactString(field.raw),
    value: field.value === null ? null : redactContactString(String(field.value)),
    // the supporting quote can carry the same personal data
    evidence: field.evidence ? redactContactString(field.evidence) : field.evidence,
  };
}

export type Audience = "public" | "admin";

/** Returns the record unchanged for an admin; a personal-data-minimised copy for the public. */
export function redactTor<T extends Pick<TorRecord, "fields">>(record: T, audience: Audience): T {
  if (audience === "admin") return record;
  return {
    ...record,
    fields: { ...record.fields, contact: redactField(record.fields.contact) },
  };
}

/** What the public is shown in place of a winner who is a natural person (TOR-221, FR-B-5). */
export const INDIVIDUAL_WINNER = "บุคคลธรรมดา";

/**
 * A winner announcement as the public sees it (TOR-221). A juristic winner's name is public record and shown
 * as extracted; a natural person's name, or a name the rule cannot place, is replaced and its raw text dropped.
 * The award's own document stays reachable through its source link (NFR-S3).
 */
export function redactAward(award: AwardResult | null | undefined, audience: Audience): AwardResult | null {
  if (!award) return null;
  if (audience === "admin" || award.winnerKind === "juristic") return award;
  return { ...award, winner: { raw: INDIVIDUAL_WINNER, value: INDIVIDUAL_WINNER, confidence: award.winner.confidence } };
}

export { redactContactString };
