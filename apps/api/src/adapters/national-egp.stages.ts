import type { ProjectStagesSource, SourceStage } from "../ports/project-stages.port.js";
import { fetchProjectStages } from "../sources/national-egp/client.js";

/**
 * e-GP's project stage table (spec 2026-11-23-egp-project-stages): one public request per project,
 * through the source's safe fetch, size cap and retry.
 */
export class NationalEgpStages implements ProjectStagesSource {
  readonly system = "national-egp" as const;

  constructor(private readonly timeZone: string) {}

  async stagesOf(projectId: string): Promise<SourceStage[]> {
    const stages = await fetchProjectStages(projectId, this.timeZone);
    return stages.map((stage) => ({ code: stage.type, description: stage.description, on: stage.announcedOn }));
  }
}
