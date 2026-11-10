import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationError } from "../ports/text-generator.port.js";

const request = vi.fn();
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() {
      return { request };
    }
  },
}));

const { VertexText } = await import("./vertex.text.js");

const config = { model: "gemini-test", location: "global", project: "proj", credentialsPath: "key.json", timeoutMs: 1000, maxOutputTokens: 100, temperature: 0.2 };
const answer = (extra: object = {}) => ({ data: { modelVersion: "gemini-test-002", candidates: [{ content: { parts: [{ text: " เรียน " }, { text: "ท่าน " }] }, ...extra }] } });

describe("VertexText", () => {
  beforeEach(() => request.mockReset());

  it("sends the system prompt, the prompt and the sampling settings, and returns the joined text and the model's version", async () => {
    request.mockResolvedValueOnce(answer());

    const result = await new VertexText(config).generate({ system: "กติกา", prompt: "ข้อมูล" });

    expect(result).toEqual({ text: "เรียน ท่าน", modelVersion: "gemini-test-002" });
    const call = request.mock.calls[0]![0];
    expect(call.url).toBe("https://aiplatform.googleapis.com/v1/projects/proj/locations/global/publishers/google/models/gemini-test:generateContent");
    expect(call.data.systemInstruction.parts[0].text).toBe("กติกา");
    expect(call.data.contents[0].parts[0].text).toBe("ข้อมูล");
    expect(call.data.generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 100 });
    expect(call.timeout).toBe(1000);
  });

  it("does not offer text that was cut off at the token cap, nor an empty answer", async () => {
    request.mockResolvedValueOnce(answer({ finishReason: "MAX_TOKENS" }));
    await expect(new VertexText(config).generate({ system: "s", prompt: "p" })).rejects.toThrow(/cut off/);
    request.mockResolvedValueOnce({ data: { candidates: [] } });
    await expect(new VertexText(config).generate({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(GenerationError);
  });

  it("fails as a GenerationError that does not repeat the prompt", async () => {
    request.mockRejectedValueOnce(new Error("503 unavailable"));
    const failure = await new VertexText(config).generate({ system: "s", prompt: "ความลับของผู้ขาย" }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(GenerationError);
    expect((failure as Error).message).toContain("503");
    expect((failure as Error).message).not.toContain("ความลับ");
  });

  it("needs a project and a credential", () => {
    expect(() => new VertexText({ ...config, project: undefined })).toThrow(/GOOGLE_CLOUD_PROJECT/);
  });
});
