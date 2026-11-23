import { calendarDate } from "../../lib/calendar-date.js";

/** One published stage of an e-GP project: the draft TOR (B0), the median price (BOQ), the invitation (D0)… */
export interface ProjectStage {
  /** e-GP's announcement type code, as e-GP gives it. */
  type: string;
  /** e-GP's own Thai name for it, when it gives one. */
  description: string | null;
  /** The announcement day in Thailand, `YYYY-MM-DD`. e-GP sends Thai midnight as the previous day's 17:00Z. */
  announcedOn: string;
}

interface StagesEnvelope {
  response?: { responseCode?: number | string };
  data?: { greenBookAnnouncementTypeLinkDto?: Array<{ announceType?: unknown; announceTypeDesc?: unknown; announceDate?: unknown }> | null } | null;
}

/**
 * The stages in e-GP's project table (spec 2026-11-23-egp-project-stages). A row without a type or a
 * readable date is dropped rather than guessed; an envelope that is not a success is no stages.
 */
export function parseProjectStages(json: unknown, timeZone: string): ProjectStage[] {
  const body = json as StagesEnvelope;
  if (String(body?.response?.responseCode) !== "0") return [];
  const rows = body.data?.greenBookAnnouncementTypeLinkDto ?? [];
  const stages: ProjectStage[] = [];
  for (const row of rows) {
    // e-GP's codes are short and plain; "price" (the bid summary) is lower case.
    if (typeof row.announceType !== "string" || !/^[A-Za-z0-9]{1,8}$/.test(row.announceType)) continue;
    if (typeof row.announceDate !== "string") continue;
    const at = new Date(row.announceDate);
    if (Number.isNaN(at.getTime())) continue;
    stages.push({
      type: row.announceType,
      description: typeof row.announceTypeDesc === "string" ? row.announceTypeDesc : null,
      announcedOn: calendarDate(at, timeZone),
    });
  }
  return stages;
}

/**
 * e-GP codes for the draft TOR, each confirmed on a real project: `B0` (69109234234) and `B3`
 * "ร่างเอกสารประกวดราคา(e-Bidding)" (69069300968, 69099528942; sampled 2026-11-23).
 */
export const DRAFT_TOR_CODES: readonly string[] = ["B0", "B3"];

/** The day the draft TOR was announced, if e-GP lists one; the earliest when it lists more than one. */
export function torAnnouncedOn(stages: ProjectStage[]): string | null {
  const days = stages.filter((stage) => DRAFT_TOR_CODES.includes(stage.type)).map((stage) => stage.announcedOn);
  return days.length > 0 ? days.sort()[0]! : null;
}
