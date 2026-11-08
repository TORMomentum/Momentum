import { describe, expect, it } from "vitest";
import type { OcrResult } from "../ports/ocr.port.js";
import { locate } from "./anchor.js";

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
