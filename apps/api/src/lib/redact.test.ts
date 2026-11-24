import { describe, expect, it } from "vitest";
import type { AwardResult, ExtractedField } from "@tor-radar/shared";
import { INDIVIDUAL_WINNER, redactAward, redactContactString, redactTor } from "./redact.js";

const field = (raw: string): ExtractedField => ({ raw, value: raw, confidence: 0.9, verified: false });

describe("redactContactString", () => {
  it("keeps an office name, an office landline, and a government URL", () => {
    const out = redactContactString(
      "สำนักงานเขตทวีวัฒนา โทรศัพท์ 0 2441 4973 ต่อ 5507 เว็บไซต์ www.bangkok.go.th/thawiwatthana",
    );
    expect(out).toContain("สำนักงานเขตทวีวัฒนา");
    expect(out).toContain("0 2441 4973");
    expect(out).toContain("www.bangkok.go.th/thawiwatthana");
  });

  it("removes a mobile number but not the office landline", () => {
    const out = redactContactString("ติดต่อ โทร 02-246-1551 มือถือ 081-234-5678");
    expect(out).toContain("02-246-1551");
    expect(out).not.toContain("081-234-5678");
  });

  it("removes an email address", () => {
    expect(redactContactString("อีเมล somchai.j@bangkok.go.th")).not.toContain("@");
  });

  it("removes a personal name and a parenthetical signature", () => {
    const out = redactContactString("ผู้ประสานงาน นายสมชาย ใจดี (นางสาวสุดใจ คงทน) โทร 0 2441 4973");
    expect(out).not.toContain("สมชาย");
    expect(out).not.toContain("สุดใจ");
    expect(out).toContain("0 2441 4973");
  });
});

describe("redactTor", () => {
  const record = {
    fields: {
      title: field("ประกวดราคาจ้าง..."),
      contact: field("นายสมชาย ใจดี โทร 089 999 9999 อีเมล x@y.com เว็บไซต์ www.gprocurement.go.th"),
    },
  };

  it("leaves the record untouched for an admin audience", () => {
    expect(redactTor(record, "admin")).toBe(record);
  });

  it("minimises the contact field for a public audience and touches nothing else", () => {
    const out = redactTor(record, "public");
    expect(out.fields.contact?.raw).not.toContain("สมชาย");
    expect(out.fields.contact?.raw).not.toContain("089 999 9999");
    expect(out.fields.contact?.raw).not.toContain("@");
    expect(out.fields.contact?.raw).toContain("www.gprocurement.go.th");
    expect(out.fields.title).toBe(record.fields.title);
  });

  it("handles a record with no contact field", () => {
    const bare = { fields: { title: field("x") } };
    expect(() => redactTor(bare, "public")).not.toThrow();
  });
});

describe("redactAward (TOR-221)", () => {
  const award = (winnerKind: "juristic" | "individual", name: string): AwardResult => ({
    recordId: "65a000000000000000000001",
    winner: { raw: name, value: name, confidence: 0.97 },
    winnerKind,
    price: { raw: "1,250,000.00 บาท", value: 1_250_000, confidence: 0.98 },
    announcedOn: "2026-11-20",
    unverified: false,
    provenance: { ocrModel: "m", extractModel: "m", modelVersion: "m-001", extractedAt: "2026-11-24T00:00:00.000Z", thresholdsVersion: "t" },
  });

  it("shows a juristic winner as extracted", () => {
    const company = award("juristic", "บริษัท สยามก่อสร้าง จำกัด");
    expect(redactAward(company, "public")).toEqual(company);
  });

  it("replaces a natural person's name, raw text included, and keeps the rest", () => {
    const shown = redactAward(award("individual", "นายสมชาย ใจดี"), "public")!;
    expect(shown.winner).toEqual({ raw: INDIVIDUAL_WINNER, value: INDIVIDUAL_WINNER, confidence: 0.97 });
    expect(JSON.stringify(shown)).not.toContain("สมชาย");
    expect(shown.price.value).toBe(1_250_000);
  });

  it("leaves an admin's view whole, and returns null for no award", () => {
    expect(redactAward(award("individual", "นายสมชาย ใจดี"), "admin")!.winner.value).toBe("นายสมชาย ใจดี");
    expect(redactAward(undefined, "public")).toBeNull();
  });
});
