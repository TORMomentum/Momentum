import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./escape-regexp.js";

describe("escapeRegExp", () => {
  it.each(["a.*(", "(a+)+$", "[x", "a|b", "\\d", "ก.ข"])("matches %s literally and only itself", (term) => {
    const re = new RegExp(escapeRegExp(term), "i");
    expect(re.test(`หัวข้อ ${term} จบ`)).toBe(true);
    expect(re.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaa!")).toBe(false);
  });

  it("does not backtrack catastrophically on a nested quantifier", () => {
    const re = new RegExp(escapeRegExp("(a+)+$"), "i");
    const started = Date.now();
    re.test(`${"a".repeat(40)}!`);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
