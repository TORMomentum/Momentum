import type { Config } from "../core/config.js";
import type { VertexConfig } from "./vertex.ai.js";

/**
 * What the extractor is built from. The worker and the extraction benchmark both call this, so the prompt and
 * schema the benchmark measures are the ones production sends: a switch that changes the request changes both
 * (a benchmark built from `config.vertex` alone would have kept measuring the old prompt).
 */
export function vertexConfig(config: Config): VertexConfig {
  return {
    ...config.vertex,
    workLocation: config.extraction.workLocation,
    biddingFields: config.extraction.biddingFields,
  };
}
