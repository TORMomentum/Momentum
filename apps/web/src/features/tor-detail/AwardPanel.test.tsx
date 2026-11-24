// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TorAward, TorDetail } from "../../shared/api/tors.api";
import { AwardPanel } from "./AwardPanel";
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
