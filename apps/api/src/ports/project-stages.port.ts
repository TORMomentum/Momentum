/** One published stage of a project, as a source lists it (TOR-205). */
export interface SourceStage {
  /** The source's own code, e.g. e-GP's announceType "B0". */
  code: string;
  /** The source's own Thai name for it; null when it gives none. */
  description: string | null;
  /** The announcement day in Thailand, `YYYY-MM-DD`. */
  on: string;
}

/**
 * Where a project's stages are read from. One implementation today, e-GP's project page
 * (adapters/national-egp.stages.ts); the stages module never reaches the source directly.
 */
export interface ProjectStagesSource {
  /** The `sourceProject.system` whose projects this source can read. */
  readonly system: "national-egp";
  /** The project's stages in the source's own order; empty when it lists none. Throws when unreachable. */
  stagesOf(projectId: string): Promise<SourceStage[]>;
}
