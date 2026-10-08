import { describe, expect, it } from "vitest";
import { matchesAnyKey } from "./intake.auth.js";

describe("matchesAnyKey", () => {
  it("accepts a key present in the list", () => {
    expect(matchesAnyKey("good", ["good", "other"])).toBe(true);
  });

  it("accepts a key that is not the first in the list", () => {
    expect(matchesAnyKey("other", ["good", "other"])).toBe(true);
  });

  it("rejects a key absent from the list", () => {
    expect(matchesAnyKey("wrong", ["good"])).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(matchesAnyKey(undefined, ["good"])).toBe(false);
  });

  it("rejects a prefix of a valid key", () => {
    expect(matchesAnyKey("goo", ["good"])).toBe(false);
  });

  it("rejects a valid key with anything appended", () => {
    expect(matchesAnyKey("goodx", ["good"])).toBe(false);
  });

  it("rejects an empty key list, so a missing configuration cannot open a route", () => {
    expect(matchesAnyKey("anything", [])).toBe(false);
  });
});
