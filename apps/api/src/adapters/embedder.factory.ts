import type { Config } from "../core/config.js";
import type { Embedder } from "../ports/embeddings.port.js";
import { VertexEmbeddings } from "./vertex.embeddings.js";

/** The embedder when `EMBEDDINGS_ENABLED` is on and Vertex credentials exist; otherwise none, and nothing is embedded. */
export function createEmbedder(config: Config): Embedder | undefined {
  if (!config.embeddings.enabled) return undefined;
  if (!config.vertex.project || !config.vertex.credentialsPath) {
    console.warn(JSON.stringify({ event: "embeddings_disabled", reason: "no Vertex credential" }));
    return undefined;
  }
  return new VertexEmbeddings({
    model: config.embeddings.model,
    location: config.embeddings.location,
    project: config.vertex.project,
    credentialsPath: config.vertex.credentialsPath,
    timeoutMs: config.vertex.timeoutMs,
  });
}
