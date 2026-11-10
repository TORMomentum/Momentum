import type { Config } from "../core/config.js";
import { GenerationError, type TextGenerator } from "../ports/text-generator.port.js";
import { VertexText } from "./vertex.text.js";

/**
 * The generator behind the cover-letter draft. Without a Vertex credential the draft is still offered when
 * DRAFT_ENABLED is on, and every attempt says so plainly (502) rather than the route vanishing: a switch that is
 * on and silently does nothing is harder to find than one that fails loudly.
 */
export function createTextGenerator(config: Config): TextGenerator {
  if (!config.vertex.project || !config.vertex.credentialsPath) {
    if (config.draft.enabled) console.warn(JSON.stringify({ event: "draft_unavailable", reason: "no Vertex credential" }));
    return { generate: async () => { throw new GenerationError("no Vertex credential"); } };
  }
  return new VertexText({
    model: config.vertex.model,
    location: config.vertex.location,
    project: config.vertex.project,
    credentialsPath: config.vertex.credentialsPath,
    timeoutMs: config.draft.timeoutMs,
    maxOutputTokens: config.draft.maxOutputTokens,
    temperature: config.draft.temperature,
  });
}
