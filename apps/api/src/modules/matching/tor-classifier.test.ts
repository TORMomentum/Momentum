import "../../test/env.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { classifyTor } from "./tor-classifier.js";

const config = loadConfig(process.env);
function record(fields: Record<string, unknown>) { return { fields } as never; }
function field(value: unknown) { return { raw: typeof value === "string" ? value : "", value, confidence: 1, verified: true }; }

describe("TOR classifier", () => {
  it("marks a procurement method as an invalid category while classifying title evidence", () => {
    const result = classifyTor(record({ title: field("ปรับปรุงผิวจราจร"), category: field("ประกวดราคาอิเล็กทรอนิกส์") }), config);
    expect(result.outcome).toBe("invalid-field-type");
    expect(result.nodes[0]?.id).toBe("construction.road");
  });

  it("maps a leaf synonym in the title", () => {
    expect(classifyTor(record({ title: field("ปรับปรุงผิวจราจร") }), config).nodes[0]?.id).toBe("construction.road");
  });

  it("returns every building specialty evidenced by one TOR", () => {
    const result = classifyTor(record({ title: field("ก่อสร้างอาคารพร้อมระบบไฟฟ้า"), category: field("งานก่อสร้าง-อาคาร") }), config);
    expect(result.leaves.map((leaf) => leaf.id)).toEqual(expect.arrayContaining(["construction.building", "construction.mep"]));
  });

  it("does not return a leaf inconsistent with the national category", () => {
    const result = classifyTor(record({ title: field("ซื้อคอมพิวเตอร์พร้อมงานก่อสร้างอาคาร"), category: field("ซื้อคอมพิวเตอร์และอุปกรณ์ไอที") }), config);
    expect(result.leaves.map((leaf) => leaf.id)).not.toContain("construction.building");
  });

  it("does not silently choose between equally strong groups", () => {
    expect(classifyTor(record({ title: field("ผิวจราจร และคอมพิวเตอร์") }), config).outcome).toBe("ambiguous");
  });

  it("returns unknown with no nodes when text is not recognisable", () => {
    const result = classifyTor(record({ title: field("โครงการทั่วไป") }), config);
    expect(result.outcome).toBe("unknown");
    expect(result.nodes).toEqual([]);
  });

  it("keeps the source field and full source text as evidence", () => {
    const text = "รายละเอียดงานปรับปรุงผิวจราจร";
    const result = classifyTor(record({ scopeSummary: field(text) }), config);
    expect(result.evidence).toContainEqual({ field: "scope", text, nodeId: "construction.road" });
  });
});
