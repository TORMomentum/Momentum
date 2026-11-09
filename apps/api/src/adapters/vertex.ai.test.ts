import "../test/env.js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentUnreadableError } from "../core/errors.js";
import { loadConfig } from "../core/config.js";
import { parseExtraction, responseSchema, systemPrompt, userPrompt, VertexAi } from "./vertex.ai.js";

const CORPUS = fileURLToPath(new URL("../../../../docs/corpus/", import.meta.url));

describe("userPrompt", () => {
  it("adds the source's publish date as a reading check only when there is one", () => {
    expect(userPrompt({})).toBe("สกัดข้อมูลตาม schema");
    const prompt = userPrompt({ sourcePublishedOn: "2026-10-02" });
    expect(prompt).toContain("2026-10-02");
    expect(prompt).toContain("ห้ามใช้เป็นค่าของ field ใด");
  });
});

describe("parseExtraction", () => {
  const wellFormed = {
    title: { raw: "จ้างก่อสร้าง...", value: "จ้างก่อสร้าง...", confidence: 0.98, evidence: "หัวเอกสาร" },
    agency: { raw: "สำนักงานเขตทวีวัฒนา", value: "สำนักงานเขตทวีวัฒนา", confidence: 0.97, evidence: "-" },
    budget_thb: { raw: "๕,๕๒๔,๐๐๐.๐๐ บาท", value: 5_524_000, confidence: 0.95, evidence: "ข้อ ๑.๔" },
    category: { raw: "งานก่อสร้าง", value: "งานก่อสร้าง-ชลประทาน", confidence: 0.9, evidence: "-" },
    scope_summary: { raw: "ขุดลอกคลอง...", value: "ขุดลอกคลอง...", confidence: 0.9, evidence: "-" },
    required_qualifications: { raw: "...", value: ["ขึ้นทะเบียนชั้น 6"], confidence: 0.85, evidence: "ข้อ ๒" },
    submission_deadline: { raw: "", value: null, confidence: 1, evidence: "ไม่ระบุ" },
    contact: { raw: "", value: null, confidence: 1, evidence: "ไม่ระบุ" },
    status: { raw: "ประกาศ", value: "announced", confidence: 0.9, evidence: "-" },
    announcement_date: { raw: "", value: null, confidence: 1, evidence: "ไม่ระบุ" },
    procurement_method: { raw: "e-bidding", value: "e-bidding", confidence: 1, evidence: "-" },
    reference_no: { raw: "", value: null, confidence: 1, evidence: "-" },
  };

  it("reads the work location, and leaves it absent from an answer that predates it", () => {
    const withLocation = parseExtraction(
      { ...wellFormed, work_location: { raw: "ต.ในเมือง จ.ขอนแก่น", value: "ต.ในเมือง จ.ขอนแก่น", confidence: 0.9, evidence: "ข้อ ๑" } },
      "m",
    );
    expect(withLocation.workLocation?.value).toBe("ต.ในเมือง จ.ขอนแก่น");
    expect(parseExtraction(wellFormed, "m").workLocation).toBeUndefined();
  });

  it("asks for the work location only when switched on, so the measured prompt is otherwise unchanged", () => {
    expect(systemPrompt()).not.toContain("work_location");
    expect(responseSchema().properties).not.toHaveProperty("work_location");
    expect(responseSchema().required).not.toContain("work_location");
    expect(systemPrompt({ workLocation: true })).toContain("work_location");
    expect(responseSchema({ workLocation: true }).properties).toHaveProperty("work_location");
    expect(responseSchema({ workLocation: true }).required).toContain("work_location");
    // The rest of the prompt is the same either way.
    expect(systemPrompt({ workLocation: true }).replace(/\n- work_location:[^\n]*/, "")).toBe(systemPrompt());
  });

  it("asks for the bidding fields only when switched on, leaving the measured prompt untouched", () => {
    const keys = ["evaluation_method", "evaluation_weights", "required_documents"];
    for (const key of keys) {
      expect(systemPrompt()).not.toContain(key);
      expect(responseSchema().properties).not.toHaveProperty(key);
      expect(systemPrompt({ biddingFields: true })).toContain(key);
      expect(responseSchema({ biddingFields: true }).properties).toHaveProperty(key);
      expect(responseSchema({ biddingFields: true }).required).toContain(key);
    }
    // Both extras together add exactly their own lines.
    const both = systemPrompt({ workLocation: true, biddingFields: true });
    expect(both.replace(/\n- (work_location|evaluation_method|evaluation_weights|required_documents):[^\n]*/g, "")).toBe(systemPrompt());
  });

  it("reads the evaluation method, weights and required documents, dropping malformed entries", () => {
    const result = parseExtraction(
      {
        ...wellFormed,
        evaluation_method: { raw: "เกณฑ์ราคาประกอบเกณฑ์อื่น", value: "price_performance", confidence: 0.9, evidence: "ข้อ ๑๓" },
        evaluation_weights: {
          raw: "ราคา ๖๐ คะแนน ผลงาน ๔๐ คะแนน",
          value: [{ name: "ราคา", weight: 60 }, { name: " ผลงาน ", weight: 40 }, { name: "", weight: 5 }, { name: "x", weight: "ten" }, null],
          confidence: 0.9,
          evidence: "ตารางข้อ ๑๓",
        },
        required_documents: {
          raw: "ISO 9001",
          value: [{ name: "ใบรับรอง ISO 9001", holder: "company" }, { name: "วิศวกรโยธา", holder: "nobody" }, { name: "  " }],
          confidence: 0.8,
          evidence: "ข้อ ๒",
        },
      },
      "m",
    );
    expect(result.evaluationMethod?.value).toBe("price_performance");
    expect(result.evaluationWeights?.value).toEqual([{ name: "ราคา", weight: 60 }, { name: "ผลงาน", weight: 40 }]);
    expect(result.requiredDocuments?.value).toEqual([
      { name: "ใบรับรอง ISO 9001", holder: "company" },
      { name: "วิศวกรโยธา", holder: "unspecified" },
    ]);
    // An unknown method is no method; a model that was not asked leaves the fields absent.
    expect(parseExtraction({ ...wellFormed, evaluation_method: { raw: "", value: "random", confidence: 1, evidence: "" } }, "m").evaluationMethod?.value).toBeNull();
    expect(parseExtraction(wellFormed, "m").evaluationWeights).toBeUndefined();
  });

  it("maps the model's snake_case output onto the camelCase port", () => {
    const result = parseExtraction(wellFormed, "gemini-3.5-flash-001");
    expect(result.budget.value).toBe(5_524_000);
    expect(result.budget.raw).toBe("๕,๕๒๔,๐๐๐.๐๐ บาท");
    expect(result.deadline.value).toBeNull();
    expect(result.qualifications.value).toEqual(["ขึ้นทะเบียนชั้น 6"]);
    expect(result.status.value).toBe("announced");
    expect(result.modelVersion).toBe("gemini-3.5-flash-001");
  });

  it("keeps a null value rather than inventing one, and floors a bad confidence to 0", () => {
    const result = parseExtraction(
      { ...wellFormed, budget_thb: { raw: "", value: "not a number", confidence: 5, evidence: "" } },
      "m",
    );
    expect(result.budget.value).toBeNull();
    expect(result.budget.confidence).toBe(0);
  });

  it("drops a status the enum does not allow", () => {
    const result = parseExtraction({ ...wellFormed, status: { ...wellFormed.status, value: "weird" } }, "m");
    expect(result.status.value).toBeNull();
  });

  it("rejects a response that is not an object", () => {
    expect(() => parseExtraction("nope", "m")).toThrow(DocumentUnreadableError);
  });

  it("rejects a document with neither a title nor an agency", () => {
    expect(() =>
      parseExtraction(
        {
          ...wellFormed,
          title: { raw: "", value: null, confidence: 0, evidence: "" },
          agency: { raw: "", value: null, confidence: 0, evidence: "" },
        },
        "m",
      ),
    ).toThrow(DocumentUnreadableError);
  });
});

const config = loadConfig(process.env);
// The file has to EXIST, not merely be configured. .env names the key file's
// path whether or not the developer has been given the key, so gating on the
// setting alone turns a missing secret into a failing suite for everyone.
const hasCreds = Boolean(
  config.vertex.project && config.vertex.credentialsPath && existsSync(config.vertex.credentialsPath),
);

// Skipped without a service-account credential so CI without secrets stays green.
// A credential being present is not consent to spend it: once the development
// .env carried the key the app needs, this ran on every `npm test` and failed
// whenever Google's token endpoint was unreachable. RUN_LIVE_VERTEX=1 opts in.
describe.skipIf(!hasCreds || process.env.RUN_LIVE_VERTEX !== "1")("VertexAi.extract against real Vertex", () => {
  it("extracts the nine fields from a real Thai TOR", async () => {
    const ai = new VertexAi(config.vertex);
    const bytes = readFileSync(CORPUS + "tor-01.pdf");

    const result = await ai.extract({ bytes, contentType: "application/pdf" });

    expect(result.agency.value).toContain("ทวีวัฒนา");
    expect(result.budget.value).toBe(5_524_000);
    expect(result.status.value).toBe("announced");
    expect(result.modelVersion).toMatch(/gemini/);
  }, 60_000);
});
