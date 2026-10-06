// Fields a national e-GP document arrives with already known, before any OCR runs.
//
// The feed states a project's title, its e-GP number and its procurement method. Those are the
// agency's own published values, so each is recorded verified at full confidence, marked
// `origin: "source"`, exactly as sources/bma-egp/enrich.ts does. The feed does not state the
// agency or the budget; extraction reads those from the document.
import type { ExtractedField, TorFields } from "@tor-radar/shared";
import type { ListItem } from "./announcements.js";
import type { FeedItem } from "./client.js";

export type EnrichableItem = Partial<Pick<FeedItem, "title" | "projectId" | "procurementMethod">>;

function stated(text: string | undefined): ExtractedField | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  return { raw: value, value, confidence: 1, verified: true, origin: "source" };
}

/** Known fields for a document whose feed item is in hand, or undefined when it states none. */
export function knownFieldsFromFeedItem(item: EnrichableItem): Partial<TorFields> | undefined {
  const fields: Partial<TorFields> = {};

  const title = stated(item.title);
  if (title) fields.title = title;

  const referenceNo = stated(item.projectId);
  if (referenceNo) fields.referenceNo = referenceNo;

  const procurementMethod = stated(item.procurementMethod);
  if (procurementMethod) fields.procurementMethod = procurementMethod;

  return Object.keys(fields).length > 0 ? fields : undefined;
}

/**
 * Known fields for a document whose row on e-GP's announcement list is in hand. The list states
 * more than the feed — the agency and the budget too — all published by e-GP, so all source values.
 * The agency's name is the value, as for an extracted agency: search, facets and peer groups key on
 * it. The budget is the วงเงินงบประมาณ the list states, never replaced by a reference price.
 */
export function knownFieldsFromListItem(item: ListItem): Partial<TorFields> | undefined {
  const fields: Partial<TorFields> = { ...knownFieldsFromFeedItem({ title: item.title, projectId: item.projectId }) };

  const agency = stated(item.agency);
  if (agency) fields.agency = agency;

  if (item.budget) {
    fields.budget = { raw: item.budget.raw, value: item.budget.value, currency: "THB", confidence: 1, verified: true, origin: "source" };
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}
