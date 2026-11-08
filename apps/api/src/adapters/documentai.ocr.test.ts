import { describe, expect, it } from "vitest";
import { parseDocument } from "./documentai.ocr.js";

describe("parseDocument", () => {
  it("turns normalised vertices into a box and reads an absent index or coordinate as 0", () => {
    const result = parseDocument(
      {
        text: "ab cd",
        pages: [
          {
            pageNumber: 1,
            tokens: [
              {
                layout: {
                  textAnchor: { textSegments: [{ endIndex: "2" }] },
                  boundingPoly: { normalizedVertices: [{ y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.3 }, { y: 0.3 }] },
                },
              },
            ],
            image: { content: Buffer.from("jpg").toString("base64"), mimeType: "image/jpeg" },
          },
        ],
      },
      "documentai:p1",
    );
    expect(result.pages[0]?.tokens).toEqual([{ start: 0, end: 2, box: [0, 0.1, 0.2, 0.3] }]);
    expect(result.pages[0]?.image?.bytes.toString()).toBe("jpg");
    expect(result.model).toBe("documentai:p1");
  });

  it("skips a token with no segment or no vertices rather than inventing a box", () => {
    const result = parseDocument({ text: "x", pages: [{ tokens: [{ layout: {} }] }] }, "m");
    expect(result.pages[0]?.tokens).toEqual([]);
    expect(result.pages[0]?.number).toBe(1);
  });
});
