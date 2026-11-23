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
    if (typeof row.announceType !== "string" || !/^[A-Z0-9]{1,8}$/.test(row.announceType)) continue;
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

/** The day the draft TOR was announced (B0), if e-GP lists one. */
export function torAnnouncedOn(stages: ProjectStage[]): string | null {
  return stages.find((stage) => stage.type === "B0")?.announcedOn ?? null;
}
