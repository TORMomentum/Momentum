import "../test/env.js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentUnreadableError } from "../core/errors.js";
import { loadConfig } from "../core/config.js";
import { parseExtraction, userPrompt, VertexAi } from "./vertex.ai.js";

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
describe.skipIf(!hasCreds)("VertexAi.extract against real Vertex", () => {
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
