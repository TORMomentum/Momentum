import { describe, expect, it } from "vitest";
import type { OcrResult } from "../ports/ocr.port.js";
import type { TorFields } from "@tor-radar/shared";
import { anchorFields, locate } from "./anchor.js";

// "ชื่อ งาน 100" read as three words on one line, then "บาท" on the next line.
const ocr: OcrResult = {
  text: "ชื่อ งาน 100\nบาท",
  model: "m",
  pages: [
    {
      number: 2,
      tokens: [
        { start: 0, end: 3, box: [0.1, 0.1, 0.2, 0.15] },
        { start: 4, end: 7, box: [0.22, 0.1, 0.3, 0.15] },
        { start: 8, end: 11, box: [0.32, 0.1, 0.4, 0.15] },
        { start: 12, end: 15, box: [0.1, 0.2, 0.2, 0.25] },
      ],
    },
  ],
};

describe("locate", () => {
  it("returns one merged box per line, on the page the text sits on", () => {
    expect(locate(ocr, "ชื่อ งาน 100 บาท")).toEqual({
      page: 2,
      boxes: [[0.1, 0.1, 0.4, 0.15], [0.1, 0.2, 0.2, 0.25]],
    });
  });

  it("ignores whitespace on both sides, which OCR and the model disagree about", () => {
    expect(locate(ocr, "ชื่องาน100")?.boxes).toEqual([[0.1, 0.1, 0.4, 0.15]]);
  });

  it("boxes only the words quoted", () => {
    expect(locate(ocr, "งาน")?.boxes).toEqual([[0.22, 0.1, 0.3, 0.15]]);
  });

  it("returns null for text that is not there or is empty, never a nearby guess", () => {
    expect(locate(ocr, "งานก่อสร้าง")).toBeNull();
    expect(locate(ocr, "   ")).toBeNull();
  });
});

// "งบ 100 บาท" in a header, then "ราคา 100 บาท ต่อหน่วย" in the body: the amount appears twice.
const twice: OcrResult = {
  text: "งบ 100 บาท\nราคา 100 บาท ต่อหน่วย",
  model: "m",
  pages: [
    {
      number: 1,
      tokens: [
        { start: 0, end: 2, box: [0.1, 0.05, 0.15, 0.08] },
        { start: 3, end: 6, box: [0.16, 0.05, 0.22, 0.08] },
        { start: 7, end: 10, box: [0.23, 0.05, 0.3, 0.08] },
        { start: 11, end: 15, box: [0.1, 0.5, 0.2, 0.53] },
        { start: 16, end: 19, box: [0.21, 0.5, 0.27, 0.53] },
        { start: 20, end: 23, box: [0.28, 0.5, 0.34, 0.53] },
        { start: 24, end: 32, box: [0.35, 0.5, 0.5, 0.53] },
      ],
    },
  ],
};

describe("a value found in more than one place", () => {
  it("gets no box, since no place is the one it was read from", () => {
    expect(locate(twice, "100")).toBeNull();
    expect(locate(twice, "100 บาท")).toBeNull();
  });

  it("is a box when the evidence quote says which one", () => {
    const fields = { budget: { raw: "100", value: 100, confidence: 0.99, verified: true, evidence: "ราคา 100 บาท" } } as unknown as TorFields;
    expect(anchorFields(fields, twice).fields.budget?.anchor?.boxes).toEqual([[0.21, 0.5, 0.27, 0.53]]);
  });

  it("stays unanchored when the evidence is as ambiguous as the value", () => {
    const fields = { budget: { raw: "100", value: 100, confidence: 0.99, verified: true, evidence: "100 บาท" } } as unknown as TorFields;
    expect(anchorFields(fields, twice).fields.budget?.anchor).toBeUndefined();
  });
});

describe("anchorFields", () => {
  const f = (raw: string, extra = {}) => ({ raw, value: raw, confidence: 0.99, verified: true, evidence: "", ...extra });

  it("anchors what the document says, and leaves source-stated and borrowed values alone", () => {
    const fields = {
      title: f("งาน"),
      agency: f("ไม่มีในเอกสาร"),
      deadline: f("100", { fromDocument: "other" }),
      referenceNo: f("บาท", { origin: "source" }),
    } as unknown as TorFields;

    const result = anchorFields(fields, ocr);

    expect(result.fields.title.anchor?.page).toBe(2);
    expect(result.fields.agency.anchor).toBeUndefined();
    expect(result.fields.deadline.anchor).toBeUndefined();
    expect(result.fields.referenceNo?.anchor).toBeUndefined();
    expect(result.pages).toEqual([2]);
  });

  it("falls back to the model's evidence quote when the value itself is not found", () => {
    const fields = { title: f("งานก่อสร้าง", { evidence: "100 บาท" }) } as unknown as TorFields;
    expect(anchorFields(fields, ocr).fields.title.anchor?.page).toBe(2);
  });
});
