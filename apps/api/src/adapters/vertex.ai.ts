import { GoogleAuth, type GoogleAuth as GoogleAuthType } from "google-auth-library";
import { TOR_CATEGORIES, normalizeCategory } from "@tor-radar/shared";
import type { EvaluationCriterion, EvaluationMethod, RequiredDocument } from "@tor-radar/shared";
import { DocumentUnreadableError, ExtractionError } from "../core/errors.js";
import type { Ai, ExtractionInput, RawExtraction, RawField, TorStatus } from "../ports/ai.port.js";

export interface VertexConfig {
  model: string;
  location: string;
  project?: string;
  credentialsPath?: string;
  timeoutMs: number;
  /**
   * Ask for where the work is done. Off by default: the confidence thresholds were
   * measured on a prompt and schema without it, so adding it is a change to the
   * measured extraction and needs the benchmark re-run first.
   */
  workLocation?: boolean;
  /** Ask for the evaluation method, its weights and the required documents (TOR-209, TOR-210). Off for the same reason. */
  biddingFields?: boolean;
}

/** Which optional fields the model is asked for; none is the prompt and schema the thresholds were measured on. */
export interface AskFor {
  workLocation?: boolean;
  biddingFields?: boolean;
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
  "title", "agency", "budget_thb", "category", "scope_summary", "scope_location", "scope_item_count", "required_qualifications",
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
    // The closed category list (packages/shared/src/categories.ts): the model chooses, never invents.
    category: field({ type: "string", enum: [...TOR_CATEGORIES], nullable: true }),
    scope_summary: field({ type: "string", nullable: true }),
    scope_location: field({ type: "string", enum: ["in_documents", "in_annex_not_provided", "none"], nullable: true }),
    scope_item_count: field({ type: "integer", nullable: true }),
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

const EVALUATION_METHODS = ["lowest_price", "price_performance", "other"] as const;
const DOCUMENT_HOLDERS = ["company", "personnel", "unspecified"] as const;

const WORK_LOCATION_SCHEMA = { work_location: field({ type: "string", nullable: true }) };
const BIDDING_SCHEMA = {
  evaluation_method: field({ type: "string", enum: [...EVALUATION_METHODS], nullable: true }),
  evaluation_weights: field({
    type: "array",
    items: {
      type: "object",
      properties: { name: { type: "string" }, weight: { type: "number" } },
      required: ["name", "weight"],
    },
  }),
  required_documents: field({
    type: "array",
    items: {
      type: "object",
      properties: { name: { type: "string" }, holder: { type: "string", enum: [...DOCUMENT_HOLDERS] } },
      required: ["name", "holder"],
    },
  }),
};

/** The schema the model answers to; optional fields are added only when asked for (TOR-313, TOR-209, TOR-210). */
export function responseSchema(ask: AskFor = {}) {
  const extra = {
    ...(ask.workLocation ? WORK_LOCATION_SCHEMA : {}),
    ...(ask.biddingFields ? BIDDING_SCHEMA : {}),
  };
  if (Object.keys(extra).length === 0) return RESPONSE_SCHEMA;
  return {
    ...RESPONSE_SCHEMA,
    properties: { ...RESPONSE_SCHEMA.properties, ...extra },
    required: [...RESPONSE_SCHEMA.required, ...Object.keys(extra)],
  };
}

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยสกัดข้อมูลจากเอกสารจัดซื้อจัดจ้าง (TOR / ประกาศประกวดราคา) ของหน่วยงานราชการไทย
สกัดเฉพาะข้อมูลที่ปรากฏจริงในเอกสาร ห้ามเดาหรือเติมจากความรู้ภายนอก
แต่ละ field ให้ตอบ:
- raw: ข้อความตามที่ปรากฏในเอกสารเป๊ะ ๆ (คงเลขไทย/รูปแบบเดิม) ถ้าไม่พบให้ raw = ""
- value: ค่าที่ normalize แล้ว — เลขไทยเป็นอารบิก, วันที่เป็น YYYY-MM-DD ปฏิทินเกรกอเรียน (พ.ศ. − 543), เงินเป็นจำนวนบาท (number ไม่มีคอมมา) ถ้าเอกสารไม่ระบุให้ value = null
- confidence: 0..1 ความมั่นใจว่าค่านั้นถูกต้อง
- evidence: ข้อความสั้น ๆ จากเอกสารที่ยืนยันค่านั้น หรืออธิบายว่าทำไมไม่พบ
กติกาเฉพาะ field:
- budget_thb: ห้ามใช้เลขหลักประกันการเสนอราคาแทนวงเงิน/ราคากลาง
- category: เลือกหนึ่งหมวดจากรายการนี้เท่านั้น ห้ามตั้งชื่อใหม่ — ${TOR_CATEGORIES.join(", ")} จัดตามสิ่งที่ซื้อหรือจ้าง: ยา เวชภัณฑ์ เครื่องมือแพทย์ เครื่องมือห้องปฏิบัติการ = ซื้อครุภัณฑ์การแพทย์และวิทยาศาสตร์, คอมพิวเตอร์ ซอฟต์แวร์ เครือข่าย = ซื้อคอมพิวเตอร์และอุปกรณ์ไอที, ทำความสะอาด รักษาความปลอดภัย ดูแลต้นไม้ เก็บขยะ = จ้างทำความสะอาดและรักษาความปลอดภัย, ออกแบบ ศึกษา ควบคุมงาน = จ้างที่ปรึกษาและออกแบบ, ก่อสร้างหรือปรับปรุงอาคาร ทาง สะพาน ชลประทาน ประปา ให้เลือกหมวดงานก่อสร้างตามสิ่งที่สร้าง raw ให้ยกข้อความในเอกสารที่ใช้ตัดสิน
- scope_location: ขอบเขตงานหรือรายละเอียดคุณลักษณะเฉพาะอยู่ที่ไหน in_documents = อยู่ในเอกสารที่ได้รับ (ไฟล์หลักหรือเอกสารแนบที่แนบมา), in_annex_not_provided = เอกสารอ้างถึงเอกสารแนบที่ไม่ได้แนบมาให้, none = ไม่มีขอบเขตงานหรือรายละเอียดคุณลักษณะเฉพาะเลย evidence ให้ระบุว่าพบที่เอกสารใด
- scope_item_count: จำนวนข้อกำหนดที่เป็นรูปธรรมในขอบเขตงานทั้งหมดจากเอกสารที่ได้รับ นับรายการที่ระบุสิ่งที่ต้องส่งมอบหรือคุณลักษณะที่ต้องมี ไม่ว่าอยู่ในรูปแบบใด — ข้อย่อยที่มีเลขกำกับ แถวในตารางคุณลักษณะเฉพาะ รายการในบัญชีแสดงปริมาณงาน (BOQ) หรือคุณลักษณะของสินค้าแต่ละรายการ ถ้าขอบเขตงานยาวมากให้ประมาณได้และลด confidence ไม่นับหัวข้ออื่นของเอกสาร เช่น คุณสมบัติผู้ยื่นข้อเสนอ หลักประกัน หรือการจ่ายเงิน ถ้า scope_location ไม่ใช่ in_documents value = null
- required_qualifications: เฉพาะคุณสมบัติที่ใช้แยกแยะผู้เสนอราคา (ชั้นทะเบียนผู้รับเหมา, มอก., วิชาชีพวิศวกรรม ฯลฯ) ไม่เอา boilerplate (ล้มละลาย, ทิ้งงาน, ลงทะเบียน e-GP)
- status: announced | closed | awarded | cancelled (ประกาศยกเลิก = cancelled)
- วันที่ทุก field: ในเอกสารสแกน เลขไทย ๙ กับ ๕ (และ ๖ กับ ๘) มักดูคล้ายกัน ให้อ่านปี พ.ศ. โดยเทียบกับวันที่อื่นในเอกสารเดียวกัน เช่น "ประกาศ ณ วันที่" หรือ "ลงวันที่" ปีย่อสองหลัก (เช่น ก.ย. ๖๙) หมายถึง พ.ศ. ๒๕๖๙
- submission_deadline: วันยื่นข้อเสนอต้องอยู่หลังวันที่ประกาศของเอกสารเดียวกัน และปกติห่างกันไม่เกินไม่กี่สัปดาห์ ถ้าอ่านแล้วได้วันยื่นข้อเสนอก่อนวันประกาศ ให้ตรวจตัวเลขนั้นใหม่ raw และ value ต้องเป็นการอ่านที่ตรวจแล้ว ถ้ายังไม่แน่ใจให้ลด confidence
ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนำหน้าหรือต่อท้าย`;

/** Added to the prompt only with `workLocation` on, after the qualifications line it follows. */
const WORK_LOCATION_PROMPT = `- work_location: สถานที่ที่ต้องทำงานหรือส่งมอบงาน (ตำบล อำเภอ จังหวัด หรือที่ตั้งสถานที่ก่อสร้าง) ตามที่เขียนในเอกสาร ห้ามใช้ที่อยู่ของหน่วยงานแทน ถ้าเอกสารไม่ระบุสถานที่ทำงาน value = null`;

/** Added only with `biddingFields` on, in the same place. */
const BIDDING_PROMPT = [
  "- evaluation_method: วิธีพิจารณาตัดสินผู้ชนะ lowest_price = พิจารณาจากราคาต่ำสุดอย่างเดียว, price_performance = พิจารณาราคาร่วมกับเกณฑ์อื่น (เช่น เกณฑ์ราคาประกอบเกณฑ์อื่น คุณภาพและราคา), other = วิธีอื่นที่เอกสารระบุ ถ้าเอกสารไม่ระบุวิธีพิจารณา value = null raw ให้ยกข้อความที่ระบุวิธีพิจารณา",
  "- evaluation_weights: เมื่อพิจารณาราคาร่วมกับเกณฑ์อื่น ให้ระบุเกณฑ์แต่ละข้อและน้ำหนักเป็นร้อยละ ในรูป [{name, weight}] ที่ weight รวมกัน 100 raw ให้ยกข้อความตารางน้ำหนัก ถ้าเป็นราคาต่ำสุดหรือเอกสารไม่ระบุน้ำหนัก value = []",
  "- required_documents: เอกสารและใบรับรองที่ผู้ยื่นข้อเสนอต้องแสดงหรือยื่นเพิ่มเติม (เช่น ใบรับรอง ISO ใบอนุญาตประกอบวิชาชีพ หนังสือรับรองผลงาน) ระบุ holder: company = นิติบุคคลต้องมี, personnel = บุคลากรหรือผู้ปฏิบัติงานที่ระบุต้องมี (เช่น วิศวกร สถาปนิก ผู้ควบคุมงาน), unspecified = เอกสารไม่ระบุ ไม่เอาเอกสารที่ทุกการยื่นข้อเสนอต้องมีเหมือนกัน (หนังสือรับรองนิติบุคคล สำเนาบัตรประชาชน)",
].join("\n");

export function systemPrompt(ask: AskFor = {}): string {
  const lines = [ask.workLocation ? WORK_LOCATION_PROMPT : "", ask.biddingFields ? BIDDING_PROMPT : ""].filter(Boolean);
  if (lines.length === 0) return SYSTEM_PROMPT;
  const marker = "\n- status:";
  return SYSTEM_PROMPT.replace(marker, `\n${lines.join("\n")}${marker}`);
}

/**
 * The instruction sent with the document. The source's publish date goes in as
 * a check on date reading only; the prompt says it is not a value to copy.
 */
export function userPrompt(input: Pick<ExtractionInput, "sourcePublishedOn" | "attachments" | "annexesLeftOut">): string {
  const lines = ["สกัดข้อมูลตาม schema"];
  if (input.attachments && input.attachments.length > 0) {
    lines.push(
      `ไฟล์แรกคือเอกสารหลัก ไฟล์ที่ตามมาคือเอกสารแนบของเอกสารเดียวกัน (${input.attachments.map((a) => a.name).join(", ")}) อ่านรวมกันเป็น TOR ฉบับเดียว`,
    );
  }
  if (input.annexesLeftOut && input.annexesLeftOut > 0) {
    lines.push(`ยังมีเอกสารแนบอีก ${input.annexesLeftOut} ไฟล์ที่ไม่ได้แนบมา ถ้าขอบเขตงานอยู่ในไฟล์เหล่านั้นให้ตอบ scope_location = in_annex_not_provided`);
  }
  if (input.sourcePublishedOn) {
    lines.push(`ระบบต้นทางระบุว่าเอกสารนี้เผยแพร่วันที่ ${input.sourcePublishedOn} (ค.ศ.) ใช้เพื่อตรวจการอ่านปีในเอกสารเท่านั้น ห้ามใช้เป็นค่าของ field ใด`);
  }
  return lines.join("\n");
}

type ModelField = { raw?: unknown; value?: unknown; confidence?: unknown; evidence?: unknown };

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const SCOPE_LOCATIONS = ["in_documents", "in_annex_not_provided", "none"] as const;
const asScopeLocation = (v: unknown): (typeof SCOPE_LOCATIONS)[number] | null =>
  typeof v === "string" && (SCOPE_LOCATIONS as readonly string[]).includes(v) ? (v as (typeof SCOPE_LOCATIONS)[number]) : null;

/** A non-negative whole number, as a count must be, or null. */
const asCountOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const EVALUATION_METHOD_SET: readonly string[] = EVALUATION_METHODS;
const HOLDER_SET: readonly string[] = DOCUMENT_HOLDERS;

const asEvaluationMethod = (v: unknown): EvaluationMethod | null =>
  typeof v === "string" && EVALUATION_METHOD_SET.includes(v) ? (v as EvaluationMethod) : null;

/** Entries without a name or a finite weight are dropped: they cannot be shown or summed. */
const asCriteria = (v: unknown): EvaluationCriterion[] =>
  (Array.isArray(v) ? v : []).flatMap((e: { name?: unknown; weight?: unknown } | null) => {
    const name = typeof e?.name === "string" ? e.name.trim() : "";
    const weight = typeof e?.weight === "number" && Number.isFinite(e.weight) ? e.weight : null;
    return name && weight !== null ? [{ name, weight }] : [];
  });

const asDocuments = (v: unknown): RequiredDocument[] =>
  (Array.isArray(v) ? v : []).flatMap((e: { name?: unknown; holder?: unknown } | null) => {
    const name = typeof e?.name === "string" ? e.name.trim() : "";
    const holder = typeof e?.holder === "string" && HOLDER_SET.includes(e.holder) ? (e.holder as RequiredDocument["holder"]) : "unspecified";
    return name ? [{ name, holder }] : [];
  });

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
    // Defensive: a value off the list (an older model, a schema the endpoint ignored) is mapped onto it.
    category: toField(m.category, normalizeCategory(asStringOrNull(m.category?.value))),
    scopeSummary: toField(m.scope_summary, asStringOrNull(m.scope_summary?.value)),
    scopeItems: toField(m.scope_item_count, asCountOrNull(m.scope_item_count?.value)),
    scopeLocation: toField(m.scope_location, asScopeLocation(m.scope_location?.value)),
    qualifications: toField(m.required_qualifications, quals),
    deadline: toField(m.submission_deadline, asStringOrNull(m.submission_deadline?.value)),
    contact: toField(m.contact, asStringOrNull(m.contact?.value)),
    status: toField(m.status, status),
    announcementDate: toField(m.announcement_date, asStringOrNull(m.announcement_date?.value)),
    procurementMethod: toField(m.procurement_method, asStringOrNull(m.procurement_method?.value)),
    referenceNo: toField(m.reference_no, asStringOrNull(m.reference_no?.value)),
    // Present only when the model was asked for it; absent means "not asked", not "not stated".
    ...(m.work_location ? { workLocation: toField(m.work_location, asStringOrNull(m.work_location.value)) } : {}),
    ...(m.evaluation_method ? { evaluationMethod: toField(m.evaluation_method, asEvaluationMethod(m.evaluation_method.value)) } : {}),
    ...(m.evaluation_weights ? { evaluationWeights: toField(m.evaluation_weights, asCriteria(m.evaluation_weights.value)) } : {}),
    ...(m.required_documents ? { requiredDocuments: toField(m.required_documents, asDocuments(m.required_documents.value)) } : {}),
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
  private readonly ask: AskFor;

  constructor(private readonly config: VertexConfig) {
    if (!config.project || !config.credentialsPath) {
      throw new Error(
        "VertexAi needs GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS; wire a fake Ai in tests instead",
      );
    }
    this.auth = new GoogleAuth({ keyFile: config.credentialsPath, scopes: SCOPES });
    this.ask = { workLocation: config.workLocation === true, biddingFields: config.biddingFields === true };
  }

  async extract(input: ExtractionInput): Promise<RawExtraction> {
    const url =
      `https://${vertexHost(this.config.location)}/v1/projects/${this.config.project}` +
      `/locations/${this.config.location}/publishers/google/models/${this.config.model}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt(this.ask) }] },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.contentType, data: input.bytes.toString("base64") } },
            // Each annex labelled, so the model can say which file a value came from.
            ...(input.attachments ?? []).flatMap((annex) => [
              { text: `เอกสารแนบ: ${annex.name}` },
              { inlineData: { mimeType: annex.contentType, data: annex.bytes.toString("base64") } },
            ]),
            { text: userPrompt(input) },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema(this.ask),
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
