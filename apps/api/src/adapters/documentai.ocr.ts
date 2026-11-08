import { GoogleAuth, type GoogleAuth as GoogleAuthType } from "google-auth-library";
import { ExtractionError } from "../core/errors.js";
import type { Ocr, OcrPage, OcrResult } from "../ports/ocr.port.js";

export interface DocumentAiConfig {
  location: string;
  project?: string;
  credentialsPath?: string;
  processorId: string;
  maxPages: number;
  timeoutMs: number;
}

const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

// Proto3 JSON leaves out zero values, so an index or a coordinate may be absent: absent means 0.
interface DocAiVertex { x?: number; y?: number }
interface DocAiPage {
  pageNumber?: number;
  tokens?: Array<{
    layout?: {
      textAnchor?: { textSegments?: Array<{ startIndex?: string; endIndex?: string }> };
      boundingPoly?: { normalizedVertices?: DocAiVertex[] };
    };
  }>;
  image?: { content?: string; mimeType?: string };
}
export interface DocAiDocument { text?: string; pages?: DocAiPage[] }

/** Maps Document AI's response to the port's shape. Pure, so it is tested without a network call. */
export function parseDocument(doc: DocAiDocument, model: string): OcrResult {
  const pages: OcrPage[] = (doc.pages ?? []).map((page, index) => {
    const tokens: OcrPage["tokens"] = [];
    for (const token of page.tokens ?? []) {
      const segment = token.layout?.textAnchor?.textSegments?.[0];
      const vertices = token.layout?.boundingPoly?.normalizedVertices ?? [];
      if (!segment || vertices.length === 0) continue;
      const xs = vertices.map((v) => v.x ?? 0);
      const ys = vertices.map((v) => v.y ?? 0);
      tokens.push({
        start: Number(segment.startIndex ?? 0),
        end: Number(segment.endIndex ?? 0),
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      });
    }
    return {
      number: page.pageNumber ?? index + 1,
      tokens,
      ...(page.image?.content
        ? { image: { bytes: Buffer.from(page.image.content, "base64"), contentType: page.image.mimeType ?? "image/jpeg" } }
        : {}),
    };
  });
  return { text: doc.text ?? "", pages, model };
}

/** Document AI Enterprise OCR over REST, authenticated like the Gemini adapter. */
export class DocumentAiOcr implements Ocr {
  private auth: GoogleAuthType;

  constructor(private readonly config: DocumentAiConfig) {
    if (!config.project || !config.credentialsPath) {
      throw new Error("DocumentAiOcr needs GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS");
    }
    this.auth = new GoogleAuth({ keyFile: config.credentialsPath, scopes: SCOPES });
  }

  async read(input: { bytes: Buffer; contentType: string }): Promise<OcrResult> {
    const { location, project, processorId } = this.config;
    const url = `https://${location}-documentai.googleapis.com/v1/projects/${project}/locations/${location}/processors/${processorId}:process`;
    const pages = Array.from({ length: this.config.maxPages }, (_, i) => i + 1);
    try {
      const client = await this.auth.getClient();
      const res = await client.request<{ document?: DocAiDocument }>({
        url,
        method: "POST",
        timeout: this.config.timeoutMs,
        data: {
          rawDocument: { content: input.bytes.toString("base64"), mimeType: input.contentType },
          // Bounds the billed pages. An image has one page, so the selector is only for documents.
          ...(input.contentType === "application/pdf" ? { processOptions: { individualPageSelector: { pages } } } : {}),
          // Words with positions, and the page image to draw on: nothing else is read back.
          fieldMask: "text,pages.pageNumber,pages.tokens,pages.image",
        },
      });
      return parseDocument(res.data.document ?? {}, `documentai:${processorId}`);
    } catch (error) {
      throw new ExtractionError(`document ai failed: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }
}
