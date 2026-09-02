import { describe, expect, it } from "vitest";
import { sha256 } from "./hash.js";

describe("sha256", () => {
  it("produces the known digest for a known input", () => {
    expect(sha256(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces the same digest for identical bytes", () => {
    expect(sha256(Buffer.from("same"))).toBe(sha256(Buffer.from("same")));
  });

  it("produces different digests for different bytes", () => {
    expect(sha256(Buffer.from("a"))).not.toBe(sha256(Buffer.from("b")));
  });
});
