import { FINAL_STAGE_KINDS, type ProjectStageEntry, type StageKind } from "@tor-radar/shared";
import type { Config } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { calendarDate } from "../../lib/calendar-date.js";
import type { ProjectStagesSource, SourceStage } from "../../ports/project-stages.port.js";
import { latestStage, stageKindOf } from "../../sources/national-egp/stages.js";
import type { StagesRepository } from "./stages.repository.js";

/** Lookups in a row that may fail before the worker backs off (spec 2026-11-23-project-stages decision 5). */
export const FAILURES_BEFORE_BACKOFF = 3;

const DAY_MS = 86_400_000;

/**
 * The stored stage list: the source's order kept, each code named by the kind table, the held documents
 * linked, and capped at `max` (the newest kept).
 */
export function stageHistoryOf(
  stages: readonly SourceStage[],
  links: { torId: string | null; invitationId: string | null },
  max: number,
): ProjectStageEntry[] {
  return stages
    .map((stage): ProjectStageEntry => {
      const kind = stageKindOf(stage.code);
      const recordId = kind === "draft" ? links.torId : kind === "invitation" ? links.invitationId : null;
      return { code: stage.code, kind, description: stage.description, on: stage.on, ...(recordId ? { recordId } : {}) };
    })
    .slice(-max);
}

/**
 * When to read the project again (decision 6): never once its stage is final, never once its newest
 * stage — or, with none listed, its announcement — is older than `maxAgeDays`; otherwise after `refreshMs`.
 */
export function nextDueAt(
  latest: { kind: StageKind; on: string } | null,
  fallbackDay: string,
  today: string,
  now: Date,
  settings: { refreshMs: number; maxAgeDays: number },
): Date | null {
  if (latest && FINAL_STAGE_KINDS.includes(latest.kind)) return null;
  const newest = latest?.on ?? fallbackDay;
  const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`)) / DAY_MS;
  if (ageDays > settings.maxAgeDays) return null;
  return new Date(now.getTime() + settings.refreshMs);
}

export interface StagesPassResult {
  projects: number;
  failed: number;
  /** True when the pass stopped on FAILURES_BEFORE_BACKOFF failures in a row: wait `backoffMs`. */
  backOff: boolean;
}

/** Reads due projects' stages from the source and stores them on their TOR records (TOR-205). */
export class StagesService {
  private readonly unknownCodes = new Set<string>();

  constructor(
    private readonly deps: {
      repo: StagesRepository;
      source: ProjectStagesSource;
      config: Config;
      now?: () => Date;
      pause?: (ms: number) => Promise<void>;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Gives the corpus that predates the worker a due time, once (spec §5). */
  async seed(): Promise<number> {
    return this.deps.repo.seedDue(this.deps.source.system, this.now());
  }

  /** One pass: up to STAGES_BATCH due records, one source request per project, paced. */
  async runPass(): Promise<StagesPassResult> {
    const { repo, source, config } = this.deps;
    const settings = config.stages;
    const pause = this.deps.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const done = new Set<string>();
    const result: StagesPassResult = { projects: 0, failed: 0, backOff: false };
    let failuresInARow = 0;

    for (let claimed = 0; claimed < settings.batch; claimed += 1) {
      const now = this.now();
      const record = await repo.claimNext(source.system, now, new Date(now.getTime() + settings.claimMs));
      if (!record) break;
      const projectId = record.sourceProject?.projectId;
      // Another record of a project already read in this pass was written with it.
      if (!projectId || done.has(projectId)) continue;
      done.add(projectId);

      if (result.projects > 0) await pause(settings.requestDelayMs);
      result.projects += 1;
      let stages: SourceStage[];
      try {
        stages = await source.stagesOf(projectId);
        failuresInARow = 0;
      } catch (error) {
        // The claim's hold is the retry delay: the record comes due again after STAGES_CLAIM_MS.
        result.failed += 1;
        failuresInARow += 1;
        logger.warn("stages_lookup_failed", { projectId, error: error instanceof Error ? error.message : "unknown" });
        if (failuresInARow >= FAILURES_BEFORE_BACKOFF) {
          result.backOff = true;
          break;
        }
        continue;
      }
      await this.store(projectId, stages);
    }
    return result;
  }

  private async store(projectId: string, stages: SourceStage[]): Promise<void> {
    const { repo, source, config } = this.deps;
    for (const stage of stages) {
      if (stageKindOf(stage.code) === "other" && !this.unknownCodes.has(stage.code)) {
        this.unknownCodes.add(stage.code);
        logger.info("stage_code_unknown", { code: stage.code, description: stage.description, projectId });
      }
    }

    const records = await repo.projectRecords(source.system, projectId);
    if (records.length === 0) return;
    const links = { torId: records[0]!._id.toString(), invitationId: await repo.invitationOf(source.system, projectId) };
    const stageHistory = stageHistoryOf(stages, links, config.stages.historyMax);
    const latest = latestStage(stageHistory.map((entry) => ({ ...entry, announcedOn: entry.on })));
    const stage = latest ? { code: latest.code, kind: latest.kind, on: latest.on } : null;
    const now = this.now();
    const today = calendarDate(now, config.search.timeZone);

    for (const record of records) {
      const fallbackDay = calendarDate(record.announcedAt ?? record.createdAt, config.search.timeZone);
      await repo.write(
        record,
        { stageHistory, stage, checkedAt: now, dueAt: nextDueAt(stage, fallbackDay, today, now, config.stages) },
        { source: source.system, actor: "stages-worker" },
      );
    }
  }
}
