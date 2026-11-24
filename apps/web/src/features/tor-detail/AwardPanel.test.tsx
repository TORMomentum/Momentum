// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TorAward, TorDetail } from "../../shared/api/tors.api";
import { AwardPanel, comparePrice } from "./AwardPanel";
import type { OriginalDocument } from "./OriginalPreview";
import { originalDocuments } from "./original-documents";
import { StagePanel } from "./StagePanel";

const TOR = "6b03fd1a1e1b2d59a19b90fa";
const AWARD = "6b03fd1a1e1b2d59a19b90fc";

const award = (extra: Partial<TorAward> = {}): TorAward => ({
  recordId: AWARD,
  winner: { raw: "บริษัท สยามก่อสร้าง จำกัด", value: "บริษัท สยามก่อสร้าง จำกัด", confidence: 0.97 },
  winnerKind: "juristic",
  price: { raw: "1,250,000.00 บาท", value: 1_250_000, confidence: 0.98 },
  announcedOn: "2026-11-20",
  unverified: false,
  provenance: { extractModel: "gemini-3.5-flash", modelVersion: "gemini-3.5-flash-001", extractedAt: "2026-11-24T02:00:00.000Z" },
  ...extra,
});

const tor = (extra: Partial<TorDetail> = {}) => ({ id: TOR, fields: {}, contentHash: "h", contentType: "application/pdf", ...extra }) as TorDetail;

const render = (value: TorAward | null | undefined, originals: OriginalDocument[] = originalDocuments(tor({ award: value }))) =>
  renderToStaticMarkup(<AwardPanel award={value} originals={originals} title="จ้างก่อสร้างอาคาร" />);

describe("AwardPanel (TOR-221)", () => {
  it("renders nothing when no winner announcement was collected", () => {
    expect(render(null)).toBe("");
    expect(render(undefined)).toBe("");
  });

  it("shows the winner as extracted, the price with the document's own text, the day, and says it is AI output", () => {
    const html = render(award());
    expect(html).toContain("ผลการประกวดราคา — สกัดโดย AI");
    expect(html).toContain("บริษัท สยามก่อสร้าง จำกัด");
    expect(html).toContain("ตามเอกสาร: 1,250,000.00 บาท");
    expect(html).toContain("ความเชื่อมั่น 97%");
    expect(html).toContain("20 พ.ย. 2569");
    expect(html).toContain("gemini-3.5-flash");
    expect(html).toContain("ดูประกาศผู้ชนะ");
    expect(html).not.toContain("ยังไม่ยืนยัน");
  });

  it("marks an unconfirmed reading, and shows an individual only as the API sent it", () => {
    const html = render(award({ unverified: true, winnerKind: "individual", winner: { raw: "บุคคลธรรมดา", value: "บุคคลธรรมดา", confidence: 0.9 } }));
    expect(html).toContain("ยังไม่ยืนยัน");
    expect(html).toContain("บุคคลธรรมดา");
  });

  it("says a value was not found rather than inventing one", () => {
    const html = render(award({ price: { raw: "", value: null, confidence: 0 } }));
    expect(html).toContain("ไม่พบในเอกสาร");
  });
});

describe("comparePrice (TOR-278)", () => {
  it("states how far below or above the budget the price is, in baht and in percent of the budget", () => {
    expect(comparePrice(1_250_000, 1_500_000)).toEqual({ price: 1_250_000, budget: 1_500_000, side: "below", difference: 250_000, percent: 16.7 });
    expect(comparePrice(1_650_000, 1_500_000)).toEqual({ price: 1_650_000, budget: 1_500_000, side: "above", difference: 150_000, percent: 10 });
    expect(comparePrice(1_500_000, 1_500_000)).toEqual({ price: 1_500_000, budget: 1_500_000, side: "equal", difference: 0, percent: 0 });
  });

  it("rounds the gap to whole satang and never shows a below-or-above gap as 0%", () => {
    expect(comparePrice(1_250_000.05, 1_500_000.1)?.difference).toBe(250_000.05);
    expect(comparePrice(9_999_900, 10_000_000)).toMatchObject({ side: "below", difference: 100, percent: 0 });
  });

  it("compares nothing unless both numbers are real and positive", () => {
    expect(comparePrice(null, 1_500_000)).toBeNull();
    expect(comparePrice(1_250_000, null)).toBeNull();
    expect(comparePrice(1_250_000, undefined)).toBeNull();
    expect(comparePrice(0, 1_500_000)).toBeNull();
    expect(comparePrice(1_250_000, 0)).toBeNull();
    expect(comparePrice(Number.NaN, 1_500_000)).toBeNull();
    expect(comparePrice(1_250_000, "1,500,000")).toBeNull();
  });
});

describe("AwardPanel price comparison (TOR-278)", () => {
  const renderWith = (value: TorAward, budget: { value?: unknown; verified?: boolean } | null) =>
    renderToStaticMarkup(<AwardPanel award={value} budget={budget} originals={originalDocuments(tor({ award: value }))} title="จ้างก่อสร้างอาคาร" />);

  it("shows the gap with both figures and where each came from, and no verdict on it", () => {
    const html = renderWith(award(), { value: 1_500_000, verified: true });
    expect(html).toContain("เทียบกับงบประมาณ");
    expect(html).toContain("ต่ำกว่างบประมาณ ฿250,000 (16.7%)");
    expect(html).toContain("งบประมาณ ฿1,500,000 ตามที่สกัดจาก TOR");
    expect(html).toContain("ราคาที่เสนอ ฿1,250,000 ตามประกาศผู้ชนะ");
    expect(html).not.toContain("ยังไม่ยืนยัน");
    for (const word of ["น่าสงสัย", "ผิดปกติ", "ทุจริต", "suspicious"]) expect(html).not.toContain(word);
  });

  it("says above when the price is above the budget, and equal when they match", () => {
    expect(renderWith(award({ price: { raw: "1,650,000", value: 1_650_000, confidence: 0.9 } }), { value: 1_500_000, verified: true })).toContain("สูงกว่างบประมาณ ฿150,000 (10%)");
    expect(renderWith(award({ price: { raw: "1,500,000", value: 1_500_000, confidence: 0.9 } }), { value: 1_500_000, verified: true })).toContain("เท่ากับงบประมาณ ฿1,500,000");
  });

  it("marks the comparison unconfirmed when either reading is", () => {
    expect(renderWith(award({ unverified: true }), { value: 1_500_000, verified: true })).toContain("เทียบกับงบประมาณ");
    expect(renderWith(award({ unverified: true }), { value: 1_500_000, verified: true }).match(/ยังไม่ยืนยัน/g)).toHaveLength(2);
    expect(renderWith(award(), { value: 1_500_000, verified: false }).match(/ยังไม่ยืนยัน/g)).toHaveLength(1);
  });

  it("shows a tiny gap as under 0.1% rather than 0%, and treats a budget that does not say it is confirmed as unconfirmed", () => {
    const tiny = renderWith(award({ price: { raw: "9,999,900", value: 9_999_900, confidence: 0.9 } }), { value: 10_000_000 });

    expect(tiny).toContain("ต่ำกว่างบประมาณ ฿100 (&lt;0.1%)");
    expect(tiny.match(/ยังไม่ยืนยัน/g)).toHaveLength(1);
  });

  it("leaves the row out when there is no budget or no price to compare", () => {
    expect(renderWith(award(), null)).not.toContain("เทียบกับงบประมาณ");
    expect(renderWith(award(), { value: null })).not.toContain("เทียบกับงบประมาณ");
    expect(renderWith(award({ price: { raw: "", value: null, confidence: 0 } }), { value: 1_500_000 })).not.toContain("เทียบกับงบประมาณ");
  });
});

describe("the winner announcement as an original (TOR-221)", () => {
  it("is offered only when the record carries an award, by the record's id", () => {
    expect(originalDocuments(tor()).map((doc) => doc.key)).toEqual(["tor"]);
    const withAward = originalDocuments(tor({ award: award() }));
    const document = withAward.find((doc) => doc.key === "award")!;
    expect(document.href).toBe(`/tors/${TOR}/original?doc=award`);
    expect(document.inlineUrl).toBe(`/tors/${AWARD}/document?disposition=inline`);
    expect(originalDocuments(tor({ award: award({ recordId: "../etc" }) })).some((doc) => doc.key === "award")).toBe(false);
  });

  it("opens from the winner stage of the timeline", () => {
    const html = renderToStaticMarkup(
      <StagePanel
        torId={TOR}
        stages={[{ code: "W0", kind: "awarded", description: "ประกาศผู้ชนะ", on: "2026-11-20", recordId: AWARD }]}
        current={{ code: "W0", kind: "awarded", on: "2026-11-20" }}
        originals={originalDocuments(tor({ award: award() }))}
        title="จ้างก่อสร้างอาคาร"
      />,
    );
    expect(html).toContain("ดูเอกสาร");
  });
});
