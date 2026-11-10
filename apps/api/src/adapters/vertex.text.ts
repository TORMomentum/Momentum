import { GoogleAuth, type GoogleAuth as GoogleAuthType } from "google-auth-library";
import { GenerationError, type TextGenerator } from "../ports/text-generator.port.js";

export interface VertexTextConfig {
  model: string;
  location: string;
  project?: string;
  credentialsPath?: string;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature: number;
}

const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  modelVersion?: string;
}

/**
 * Plain text from Gemini on Vertex AI, for the cover-letter draft (TOR-220).
 *
 * ponytail: the host and auth are the extractor's, repeated here rather than shared, because the extractor's
 * request is JSON-schema shaped and this one is not; share the client if a third caller appears. One try, no
 * retry loop: a vendor is waiting on a click and can press it again.
 */
export class VertexText implements TextGenerator {
  private readonly auth: GoogleAuthType;

  constructor(private readonly config: VertexTextConfig) {
    if (!config.project || !config.credentialsPath) {
      throw new Error("VertexText needs GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS; wire a fake TextGenerator in tests instead");
    }
    this.auth = new GoogleAuth({ keyFile: config.credentialsPath, scopes: SCOPES });
  }

  async generate(input: { system: string; prompt: string }): Promise<{ text: string; modelVersion: string }> {
    const host = this.config.location === "global" ? "aiplatform.googleapis.com" : `${this.config.location}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${this.config.project}/locations/${this.config.location}/publishers/google/models/${this.config.model}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: "user", parts: [{ text: input.prompt }] }],
      generationConfig: { temperature: this.config.temperature, maxOutputTokens: this.config.maxOutputTokens },
    };
    let data: GenerateResponse;
    try {
      const client = await this.auth.getClient();
      data = (await client.request<GenerateResponse>({ url, method: "POST", data: body, timeout: this.config.timeoutMs })).data;
    } catch (error) {
      // The message can carry the request URL but never the prompt, which is the vendor's data.
      throw new GenerationError(`vertex generateContent failed: ${error instanceof Error ? error.message : "request failed"}`);
    }
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new GenerationError("model returned no text");
    // Only a natural stop is a finished letter. A cut-off at the token cap, a block (RECITATION, SAFETY...), OTHER
    // and CONTINUATION (more still to come) can all arrive with text in them; none of it is offered as a draft.
    if (candidate?.finishReason !== "STOP") throw new GenerationError(`model did not finish: ${candidate?.finishReason ?? "no finish reason"}`);
    return { text, modelVersion: data.modelVersion ?? this.config.model };
  }
}
