import { GoogleAuth, type GoogleAuth as GoogleAuthType } from "google-auth-library";
import { DocumentUnreadableError, ExtractionError } from "../core/errors.js";
import type { Ai, ExtractionInput, RawExtraction, RawField, TorStatus } from "../ports/ai.port.js";

export interface VertexConfig {
  model: string;
  location: string;
  project?: string;
  credentialsPath?: string;
  timeoutMs: number;
}

const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

/** "global" has no region prefix; any other location does. */
function vertexHost(location: string): string {
  return location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
}

// The nine FR-B-2 fields plus the three cheap extras. Model-facing keys stay the
// snake_case ones the TOR-18 benchmark validated; the mapping to the camelCase
// port happens in parseExtraction.
const MODEL_KEYS = [
  "title", "agency", "budget_thb", "category", "scope_summary", "required_qualifications",
  "submission_deadline", "contact", "status", "announcement_date", "procurement_method", "reference_no",
] as const;

const field = (valueSchema: object) => ({
  type: "object",
  properties: {
    raw: { type: "string" },
    value: valueSchema,
    confidence: { type: "number" },
    evidence: { type: "string" },
  },
  required: ["raw", "value", "confidence", "evidence"],
});

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: field({ type: "string", nullable: true }),
    agency: field({ type: "string", nullable: true }),
    budget_thb: field({ type: "number", nullable: true }),
    category: field({ type: "string", nullable: true }),
    scope_summary: field({ type: "string", nullable: true }),
    required_qualifications: field({ type: "array", items: { type: "string" } }),
    submission_deadline: field({ type: "string", nullable: true }),
    contact: field({ type: "string", nullable: true }),
    status: field({ type: "string", enum: ["announced", "closed", "awarded", "cancelled"], nullable: true }),
    announcement_date: field({ type: "string", nullable: true }),
    procurement_method: field({ type: "string", nullable: true }),
    reference_no: field({ type: "string", nullable: true }),
  },
  required: [...MODEL_KEYS],
};

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยสกัดข้อมูลจากเอกสารจัดซื้อจัดจ้าง (TOR / ประกาศประกวดราคา) ของหน่วยงานราชการไทย
สกัดเฉพาะข้อมูลที่ปรากฏจริงในเอกสาร ห้ามเดาหรือเติมจากความรู้ภายนอก
แต่ละ field ให้ตอบ:
- raw: ข้อความตามที่ปรากฏในเอกสารเป๊ะ ๆ (คงเลขไทย/รูปแบบเดิม) ถ้าไม่พบให้ raw = ""
- value: ค่าที่ normalize แล้ว — เลขไทยเป็นอารบิก, วันที่เป็น YYYY-MM-DD ปฏิทินเกรกอเรียน (พ.ศ. − 543), เงินเป็นจำนวนบาท (number ไม่มีคอมมา) ถ้าเอกสารไม่ระบุให้ value = null
- confidence: 0..1 ความมั่นใจว่าค่านั้นถูกต้อง
- evidence: ข้อความสั้น ๆ จากเอกสารที่ยืนยันค่านั้น หรืออธิบายว่าทำไมไม่พบ
กติกาเฉพาะ field:
- budget_thb: ห้ามใช้เลขหลักประกันการเสนอราคาแทนวงเงิน/ราคากลาง
- category: คำสั้น ๆ เช่น งานก่อสร้าง-ทาง, งานก่อสร้าง-ชลประทาน, งานก่อสร้าง-อาคาร, จ้างเหมาบริการ, ซื้อครุภัณฑ์, จ้างที่ปรึกษา
- required_qualifications: เฉพาะคุณสมบัติที่ใช้แยกแยะผู้เสนอราคา (ชั้นทะเบียนผู้รับเหมา, มอก., วิชาชีพวิศวกรรม ฯลฯ) ไม่เอา boilerplate (ล้มละลาย, ทิ้งงาน, ลงทะเบียน e-GP)
- status: announced | closed | awarded | cancelled (ประกาศยกเลิก = cancelled)
ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนำหน้าหรือต่อท้าย`;

type ModelField = { raw?: unknown; value?: unknown; confidence?: unknown; evidence?: unknown };

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asNumberOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const asStringOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;
const asConfidence = (v: unknown): number =>
  typeof v === "number" && v >= 0 && v <= 1 ? v : 0;

function toField<T>(mf: ModelField | undefined, value: T | null): RawField<T> {
  return {
    raw: asString(mf?.raw),
    value,
    confidence: asConfidence(mf?.confidence),
    evidence: asString(mf?.evidence),
  };
}

const VALID_STATUS = new Set<TorStatus>(["announced", "closed", "awarded", "cancelled"]);

/**
 * Maps the model's JSON to the port's `RawExtraction`. Pure and exported so the
 * mapping is unit-tested without a network call. Throws `DocumentUnreadableError`
 * when the response has no usable structure or no title and no agency - retrying
 * that document will not help.
 */
export function parseExtraction(modelJson: unknown, modelVersion: string): RawExtraction {
  if (typeof modelJson !== "object" || modelJson === null) {
    throw new DocumentUnreadableError("model response was not a JSON object");
  }
  const m = modelJson as Record<string, ModelField | undefined>;

  const quals = Array.isArray(m.required_qualifications?.value)
    ? (m.required_qualifications!.value as unknown[]).filter((q): q is string => typeof q === "string")
    : [];
  const statusValue = asStringOrNull(m.status?.value);
  const status = statusValue && VALID_STATUS.has(statusValue as TorStatus) ? (statusValue as TorStatus) : null;

  const extraction: RawExtraction = {
    title: toField(m.title, asStringOrNull(m.title?.value)),
    agency: toField(m.agency, asStringOrNull(m.agency?.value)),
    budget: toField(m.budget_thb, asNumberOrNull(m.budget_thb?.value)),
    category: toField(m.category, asStringOrNull(m.category?.value)),
    scopeSummary: toField(m.scope_summary, asStringOrNull(m.scope_summary?.value)),
    qualifications: toField(m.required_qualifications, quals),
    deadline: toField(m.submission_deadline, asStringOrNull(m.submission_deadline?.value)),
    contact: toField(m.contact, asStringOrNull(m.contact?.value)),
    status: toField(m.status, status),
    announcementDate: toField(m.announcement_date, asStringOrNull(m.announcement_date?.value)),
    procurementMethod: toField(m.procurement_method, asStringOrNull(m.procurement_method?.value)),
    referenceNo: toField(m.reference_no, asStringOrNull(m.reference_no?.value)),
    modelVersion,
  };

  if (extraction.title.value === null && extraction.agency.value === null) {
    throw new DocumentUnreadableError("model found neither a title nor an issuing agency");
  }
  return extraction;
}

/** Model output sometimes carries chatter despite responseMimeType - slice the object out. */
function parseLenient(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new ExtractionError("model did not return JSON");
  }
}

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  modelVersion?: string;
}

export class VertexAi implements Ai {
  private auth: GoogleAuthType;

  constructor(private readonly config: VertexConfig) {
    if (!config.project || !config.credentialsPath) {
      throw new Error(
        "VertexAi needs GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS; wire a fake Ai in tests instead",
      );
    }
    this.auth = new GoogleAuth({ keyFile: config.credentialsPath, scopes: SCOPES });
  }

  async extract(input: ExtractionInput): Promise<RawExtraction> {
    const url =
      `https://${vertexHost(this.config.location)}/v1/projects/${this.config.project}` +
      `/locations/${this.config.location}/publishers/google/models/${this.config.model}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.contentType, data: input.bytes.toString("base64") } },
            { text: "สกัดข้อมูลตาม schema" },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
        maxOutputTokens: 8192,
      },
    };

    const data = await this.callWithRetry(url, body);
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) throw new ExtractionError("model returned an empty response");
    return parseExtraction(parseLenient(text), data.modelVersion ?? this.config.model);
  }

  private async callWithRetry(url: string, body: unknown, tries = 4): Promise<GenerateResponse> {
    const client = await this.auth.getClient();
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await client.request<GenerateResponse>({
          url,
          method: "POST",
          data: body,
          timeout: this.config.timeoutMs,
        });
        return res.data;
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if ((status === 429 || status === 503) && attempt < tries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt));
          continue;
        }
        const message = error instanceof Error ? error.message : "vertex request failed";
        throw new ExtractionError(`vertex generateContent failed: ${message}`);
      }
    }
  }
}
