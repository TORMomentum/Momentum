import { describe, expect, it } from "vitest";
import { cosine } from "../ports/embeddings.port.js";
import { parsePredictions } from "./vertex.embeddings.js";

describe("parsePredictions", () => {
  it("returns one vector per text", () => {
    expect(parsePredictions({ predictions: [{ embeddings: { values: [1, 0] } }, { embeddings: { values: [0, 1] } }] }, 2)).toEqual([[1, 0], [0, 1]]);
  });

  it("refuses a response with a missing or empty vector rather than comparing nothing", () => {
    expect(() => parsePredictions({ predictions: [{ embeddings: { values: [1] } }] }, 2)).toThrow(/one vector per text/);
    expect(() => parsePredictions({ predictions: [{}] }, 1)).toThrow(/one vector per text/);
  });
});

describe("cosine", () => {
  it("is 1 for the same direction, 0 for orthogonal, and 0 for a zero or mismatched vector", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1], [1, 1])).toBe(0);
  });
});
