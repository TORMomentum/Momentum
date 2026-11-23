import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvLine, EXPORT_HEADER, exportRow } from "./export.csv.js";

describe("CSV cells (RFC 4180)", () => {
  it("quotes commas, quotes and line breaks, and leaves plain text alone", () => {
    expect(csvCell("งานก่อสร้าง")).toBe("งานก่อสร้าง");
    expect(csvCell("1,000,000.00")).toBe('"1,000,000.00"');
    expect(csvCell('ชื่อ "โครงการ"')).toBe('"ชื่อ ""โครงการ"""');
    expect(csvCell("บรรทัดหนึ่ง\nบรรทัดสอง")).toBe('"บรรทัดหนึ่ง\nบรรทัดสอง"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(96500000)).toBe("96500000");
  });

  it("never lets a spreadsheet read a value as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+66 2 123 4567")).toBe("'+66 2 123 4567");
    expect(csvCell("-")).toBe("'-");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    // A number is a number, not text a formula could hide in.
    expect(csvCell(-5)).toBe("-5");
  });

  it("ends a line with CRLF, and the file starts with a byte-order mark for Excel", () => {
    expect(csvLine(["a", "b,c"])).toBe('a,"b,c"\r\n');
    expect(CSV_BOM).toBe("\uFEFF");
  });
});

describe("one exported row", () => {
  const item = {
    id: "6ac65474caacd671072bf14b",
    announcedAt: "2026-10-07T00:00:00.000Z",
    confidenceLevel: "medium",
    unverified: true,
    title: { raw: "ประกวดราคาจ้างพัฒนาระบบ", verified: true },
    referenceNo: { raw: "69109019390", verified: true },
    agency: { raw: "การรถไฟแห่งประเทศไทย", value: "การรถไฟแห่งประเทศไทย", verified: true },
    category: { raw: "โครงการจ้างพัฒนาระบบ", value: "ซื้อคอมพิวเตอร์และอุปกรณ์ไอที", verified: false },
    budget: { raw: "96,500,000.00", value: 96500000, verified: true },
    deadline: { raw: "๓๐ พฤศจิกายน ๒๕๖๙", value: "2026-11-30", verified: true },
    torStatus: { value: "announced", verified: false },
  };
  const provenance = {
    ocrModel: "documentai",
    extractModel: "gemini-x",
    modelVersion: "gemini-x-001",
    extractedAt: "2026-11-23T08:00:00.000Z",
    thresholdsVersion: "1",
  };

  it("lines up with the header, keeps values as extracted, and links to the source", () => {
    const row = exportRow(item, provenance, "https://tor-radar.example");
    expect(row).toHaveLength(EXPORT_HEADER.length);
    const byHeader = Object.fromEntries(EXPORT_HEADER.map((header, i) => [header, row[i]]));
    expect(byHeader).toMatchObject({
      รหัสระเบียน: item.id,
      เลขที่โครงการ: "69109019390",
      หมวดหมู่: "ซื้อคอมพิวเตอร์และอุปกรณ์ไอที",
      หมวดหมู่ตามเอกสาร: "โครงการจ้างพัฒนาระบบ",
      "งบประมาณ (บาท)": 96500000,
      งบประมาณตามเอกสาร: "96,500,000.00",
      กำหนดยื่นข้อเสนอ: "2026-11-30",
      กำหนดยื่นข้อเสนอตามเอกสาร: "๓๐ พฤศจิกายน ๒๕๖๙",
      วันที่ประกาศ: "2026-10-07",
      ระดับความมั่นใจ: "medium",
      ยังไม่ยืนยันการสกัด: "ใช่",
      ฟิลด์ที่ยังไม่ยืนยัน: "category;torStatus",
      โมเดลที่สกัด: "gemini-x",
      เวอร์ชันโมเดล: "gemini-x-001",
      เวลาที่สกัด: "2026-11-23T08:00:00.000Z",
      "หน้า TOR": "https://tor-radar.example/tors/6ac65474caacd671072bf14b",
      เอกสารต้นฉบับ: "https://tor-radar.example/tors/6ac65474caacd671072bf14b/document",
    });
  });

  it("leaves provenance empty rather than inventing it", () => {
    const row = exportRow({ ...item, announcedAt: null }, undefined, "https://tor-radar.example");
    const byHeader = Object.fromEntries(EXPORT_HEADER.map((header, i) => [header, row[i]]));
    expect(byHeader).toMatchObject({ โมเดลที่สกัด: "", เวอร์ชันโมเดล: "", เวลาที่สกัด: "", วันที่ประกาศ: "" });
  });
});
