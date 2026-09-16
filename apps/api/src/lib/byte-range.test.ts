import { describe, expect, it } from "vitest";
import { parseRange } from "./byte-range.js";

const SIZE = 1000;

describe("parseRange", () => {
  it("serves the whole object when there is no Range header", () => {
    expect(parseRange(undefined, SIZE)).toEqual({ kind: "full" });
  });

  it("parses a closed range", () => {
    expect(parseRange("bytes=0-99", SIZE)).toEqual({ kind: "partial", start: 0, end: 99 });
  });

  it("parses an open-ended range to the last byte", () => {
    expect(parseRange("bytes=900-", SIZE)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("parses a suffix range as the last n bytes", () => {
    expect(parseRange("bytes=-100", SIZE)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("clamps a suffix longer than the object to the whole object", () => {
    expect(parseRange("bytes=-5000", SIZE)).toEqual({ kind: "partial", start: 0, end: 999 });
  });

  it("clamps an end past the object to the last byte", () => {
    expect(parseRange("bytes=500-99999", SIZE)).toEqual({ kind: "partial", start: 500, end: 999 });
  });

  it("is unsatisfiable when the start is at or beyond the end", () => {
    expect(parseRange("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=5000-6000", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("is unsatisfiable for a zero-length suffix", () => {
    expect(parseRange("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("ignores multiple ranges and serves the whole object (RFC 9110 permits this)", () => {
    expect(parseRange("bytes=0-10,20-30", SIZE)).toEqual({ kind: "full" });
  });

  it("ignores malformed ranges and serves the whole object", () => {
    expect(parseRange("bytes=abc", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("items=0-10", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("bytes=-", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("bytes=50-10", SIZE)).toEqual({ kind: "full" });
  });

  it("treats any range on an empty object as unsatisfiable", () => {
    expect(parseRange("bytes=0-10", 0)).toEqual({ kind: "unsatisfiable" });
  });
});
