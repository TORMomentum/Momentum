import type { StageKind } from "@tor-radar/shared";
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

/**
 * e-GP's code for the invitation to bid, `D0` "ประกาศเชิญชวน". A project that skips the draft-TOR hearing
 * publishes its TOR first with this announcement (sampled 2026-11-23: 111 of 240 projects list no draft).
 */
export const INVITATION_CODE = "D0";

const earliestOf = (stages: ProjectStage[], codes: readonly string[]): string | null => {
  const days = stages.filter((stage) => codes.includes(stage.type)).map((stage) => stage.announcedOn);
  return days.length > 0 ? days.sort()[0]! : null;
};

/**
 * The day the TOR was first published: the draft TOR's day when e-GP lists one (the earliest when it
 * lists more than one); otherwise, for a project with no draft-TOR stage, the day of its first
 * invitation, which is when that TOR went out. Null when e-GP lists neither.
 */
export function torAnnouncedOn(stages: ProjectStage[]): string | null {
  return earliestOf(stages, DRAFT_TOR_CODES) ?? earliestOf(stages, [INVITATION_CODE]);
}

/**
 * e-GP announcement codes whose meaning has been confirmed on a sampled project (spec
 * 2026-11-23-project-stages §3). A code is added here only from a real project page, never guessed:
 * a wrong `awarded` or `cancelled` would close a project that is still taking bids.
 */
export const STAGE_KINDS: Readonly<Record<string, StageKind>> = {
  B0: "draft",
  // ร่างเอกสารประกวดราคา(e-Bidding): 69069300968, 69099528942.
  B3: "draft",
  BOQ: "median-price",
  D0: "invitation",
  // ประกาศรายชื่อผู้ชนะการเสนอราคา: 69029401277, 69119388625.
  W0: "awarded",
  // เปลี่ยนแปลงประกาศรายชื่อผู้ชนะการเสนอราคา, after a W0: the winner announcement amended, still a winner.
  // 69109402570 (W0 2026-11-11, W2 2026-11-19).
  W2: "awarded",
  // ยกเลิกประกาศเชิญชวน: 69069300968, 69099528942.
  D1: "cancelled",
};

/** The kind of an e-GP stage code; `other` for a code not in `STAGE_KINDS`. */
export function stageKindOf(code: string): StageKind {
  return Object.hasOwn(STAGE_KINDS, code) ? STAGE_KINDS[code]! : "other";
}

/**
 * The newest stage: the latest day, and on a tie the one e-GP lists last (its table is in publication
 * order). Null when there are no stages.
 */
export function latestStage<T extends { announcedOn: string }>(stages: readonly T[]): T | null {
  let latest: T | null = null;
  for (const stage of stages) if (!latest || stage.announcedOn >= latest.announcedOn) latest = stage;
  return latest;
}
