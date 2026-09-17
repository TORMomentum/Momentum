// Fields a BMA eGP document arrives with already known, before any OCR runs.
//
// A document fetched from the source API is not a mystery PDF: the API states the project's title,
// its number, the agency that issued it and its budget. Those values are the agency's own, not a
// model's reading of a scan, so each is recorded verified at full confidence, marked
// `origin: "source"`, and exempt from the "unverified extraction" marking of SRS §4.2.1.
// Extraction later fills only the fields that genuinely have to be read out of the document, and
// never overwrites these.
//
// This is a pure mapping on purpose. A collector fetching from this source already holds the
// project record — it had to, to build the file URL — so nothing here needs the network. Anything
// arriving without that context (a plain upload) simply carries no known fields and waits for
// extraction, which is the normal path.
import type { ExtractedField, TorFields } from "@tor-radar/shared";
import type { BmaEgpProject } from "./client.js";

/** The subset of a source project this mapping reads. */
export type EnrichableProject = Partial<
  Pick<BmaEgpProject, "masterOrgGroupName" | "projectName" | "projectNumber" | "projectBudget">
>;

function stated(text: string | undefined): ExtractedField | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  return { raw: value, value, confidence: 1, verified: true, origin: "source" };
}

/**
 * Known fields for a document whose source project is in hand.
 * Returns undefined when the project states none of them, so callers can pass the result straight
 * through without checking for an empty object.
 */
export function knownFieldsFromProject(project: EnrichableProject): Partial<TorFields> | undefined {
  const fields: Partial<TorFields> = {};

  const title = stated(project.projectName);
  if (title) fields.title = title;

  // The agency's published name is the value, as it is for an extracted agency: search filters,
  // facets and the anomaly rule's peer groups all key on `agency.value`, so an id here would split
  // one agency into two. The canonical id stays derivable from the name (resolveBmaAgency), and
  // scope is national, so an agency missing from the seeded list is recorded, never rejected.
  const agency = stated(project.masterOrgGroupName);
  if (agency) fields.agency = agency;

  // วงเงินงบประมาณ — the project's budget as the source states it. A document may instead state a
  // ราคากลาง (reference price); that is a different figure, and this one is not replaced by it.
  const budget = project.projectBudget;
  if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
    fields.budget = {
      raw: String(budget),
      value: budget,
      currency: "THB",
      confidence: 1,
      verified: true,
      origin: "source",
    };
  }

  const referenceNo = stated(project.projectNumber);
  if (referenceNo) fields.referenceNo = referenceNo;

  return Object.keys(fields).length > 0 ? fields : undefined;
}
