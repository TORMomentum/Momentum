import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./escape-regexp.js";

describe("escapeRegExp", () => {
  it.each([
    ["a.*(", "a\\.\\*\\("],
    ["(a+)+$", "\\(a\\+\\)\\+\\$"],
    ["[x", "\\[x"],
    ["a|b", "a\\|b"],
    ["\\d", "\\\\d"],
    ["ก.ข", "ก\\.ข"],
  ])("escapes every metacharacter in %s", (term, literal) => {
    expect(escapeRegExp(term)).toBe(literal);
  });

  it("does not backtrack catastrophically on a nested quantifier", () => {
    const re = new RegExp(escapeRegExp("(a+)+$"), "i");
    const started = Date.now();
    re.test(`${"a".repeat(40)}!`);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
