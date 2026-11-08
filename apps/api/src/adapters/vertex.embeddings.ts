import { GoogleAuth, type GoogleAuth as GoogleAuthType } from "google-auth-library";
import { ExtractionError } from "../core/errors.js";
import type { Embedder } from "../ports/embeddings.port.js";

export interface VertexEmbeddingsConfig {
  model: string;
  location: string;
  project?: string;
  credentialsPath?: string;
  timeoutMs: number;
}

/** Texts per request: the smallest limit among the embedding models. */
const BATCH = 5;
const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

interface PredictResponse {
  predictions?: Array<{ embeddings?: { values?: number[] } }>;
}

/** Maps the response to vectors, one per text. Pure, so it is tested without a network call. */
export function parsePredictions(data: PredictResponse, expected: number): number[][] {
  const vectors = (data.predictions ?? []).map((p) => p.embeddings?.values ?? []);
  if (vectors.length !== expected || vectors.some((v) => v.length === 0)) {
    throw new ExtractionError("embedding response did not carry one vector per text");
  }
  return vectors;
}

export class VertexEmbeddings implements Embedder {
  private auth: GoogleAuthType;
  readonly model: string;

  constructor(private readonly config: VertexEmbeddingsConfig) {
    if (!config.project || !config.credentialsPath) {
      throw new Error("VertexEmbeddings needs GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS");
    }
    this.model = config.model;
    this.auth = new GoogleAuth({ keyFile: config.credentialsPath, scopes: SCOPES });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const { location, project, model, timeoutMs } = this.config;
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
    const out: number[][] = [];
    try {
      const client = await this.auth.getClient();
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const res = await client.request<PredictResponse>({
          url,
          method: "POST",
          timeout: timeoutMs,
          data: { instances: batch.map((content) => ({ content, task_type: "SEMANTIC_SIMILARITY" })) },
        });
        out.push(...parsePredictions(res.data, batch.length));
      }
    } catch (error) {
      if (error instanceof ExtractionError) throw error;
      throw new ExtractionError(`embedding request failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
    return out;
  }
}
