// Fields a BMA eGP document arrives with already known, before any OCR runs.
//
// A document fetched from the source API is not a mystery PDF: the API states which agency issued
// the project it belongs to. That value is the agency's own, not a model's reading of a scan, so it
// is recorded verified at full confidence and is exempt from the "unverified extraction" marking of
// SRS §4.2.1. Extraction later fills the fields that genuinely have to be read out of the document.
//
// This is a pure mapping on purpose. A collector fetching from this source already holds the
// project record — it had to, to build the file URL — so nothing here needs the network. Anything
// arriving without that context (a plain upload) simply carries no known fields and waits for
// extraction, which is the normal path.
import type { ExtractedField } from "@tor-radar/shared";
import { resolveBmaAgency } from "../bmaAgencies.js";
import type { BmaEgpProject } from "./client.js";

/** The subset of a source project this mapping reads. */
export type EnrichableProject = Pick<BmaEgpProject, "masterOrgGroupName">;

/**
 * Known fields for a document whose source project is in hand.
 * Returns undefined when the project states no agency, so callers can pass the result straight
 * through without checking for an empty object.
 */
export function knownFieldsFromProject(
  project: EnrichableProject,
): Record<string, ExtractedField> | undefined {
  const agencyName = project.masterOrgGroupName?.trim();
  if (!agencyName) return undefined;

  const agency = resolveBmaAgency(agencyName);

  return {
    agency: {
      raw: agencyName,
      // The canonical id when the name is on the seeded list; otherwise the record keeps the
      // agency's own wording and carries no id. Scope is national, so an unrecognised agency is
      // never a reason to reject the document or to discard the name it published under.
      value: agency?.agency_id,
      confidence: 1,
      verified: true,
    },
  };
}
