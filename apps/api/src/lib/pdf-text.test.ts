import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasTextLayer } from "./pdf-text.js";

const CORPUS = fileURLToPath(new URL("../../../../docs/corpus/", import.meta.url));

describe("hasTextLayer", () => {
  it("is false for a non-PDF content type", () => {
    expect(hasTextLayer(Buffer.from("anything"), "image/jpeg")).toBe(false);
    expect(hasTextLayer(Buffer.from("anything"), "image/png")).toBe(false);
  });

  it("is true for a digital TOR from the benchmark corpus", () => {
    expect(hasTextLayer(readFileSync(CORPUS + "tor-01.pdf"), "application/pdf")).toBe(true);
    expect(hasTextLayer(readFileSync(CORPUS + "tor-09.pdf"), "application/pdf")).toBe(true);
  });

  it("is false for a scanned TOR (image-only PDF)", () => {
    expect(hasTextLayer(readFileSync(CORPUS + "_extra/tor-03.pdf"), "application/pdf")).toBe(false);
    expect(hasTextLayer(readFileSync(CORPUS + "_extra/tor-06.pdf"), "application/pdf")).toBe(false);
  });

  it("does not crash on bytes that are not a real PDF", () => {
    expect(hasTextLayer(Buffer.from("%PDF-1.4\ngarbage"), "application/pdf")).toBe(false);
  });
});
