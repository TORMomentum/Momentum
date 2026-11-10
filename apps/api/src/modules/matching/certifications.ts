import { CERTIFICATIONS, certificationsMentioned } from "@tor-radar/seeds";
import type { TorDocument } from "../../core/db.js";

const nameOf = new Map<string, string>(CERTIFICATIONS.map((item) => [item.id, item.th]));

export function qualificationText(record: Pick<TorDocument, "fields">): string {
  const value = record.fields.qualifications?.value;
  return Array.isArray(value) ? value.join("\n") : "";
}

export { certificationsMentioned };

export function certificationName(id: string): string {
  return nameOf.get(id) ?? id;
}
