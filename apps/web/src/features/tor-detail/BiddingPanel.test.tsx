// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TorDetailField } from "../../shared/api/tors.api";
import { BiddingPanel } from "./BiddingPanel";

const field = (value: unknown, extra: Partial<TorDetailField> = {}): TorDetailField => ({
  raw: "",
  value,
  confidence: 0.9,
  verified: true,
  ...extra,
});

const render = (props: Parameters<typeof BiddingPanel>[0]) => renderToStaticMarkup(<BiddingPanel {...props} />);

describe("BiddingPanel", () => {
  it("renders nothing for a record extracted before these fields existed", () => {
    expect(render({})).toBe("");
    expect(render({ evaluationWeights: field(null), requiredDocuments: field([]) })).toBe("");
  });

  it("shows a price-performance evaluation with each weight, their sum, the AI label and the document's words", () => {
    const html = render({
      evaluationMethod: field("price_performance", { raw: "เกณฑ์ราคาและประสิทธิภาพ" }),
      evaluationWeights: field([
        { name: "ข้อเสนอด้านเทคนิค", weight: 60 },
        { name: "ข้อเสนอด้านราคา", weight: 40 },
      ]),
    });
    expect(html).toContain("สกัดโดย AI");
    expect(html).toContain("ให้คะแนนตามหัวข้อ");
    expect(html).toContain("ตามเอกสาร: เกณฑ์ราคาและประสิทธิภาพ");
    expect(html).toContain("ข้อเสนอด้านเทคนิค");
    expect(html).toContain(">60<");
    expect(html).toContain(">100<");
    expect(html).not.toContain("ยังไม่ยืนยัน");
  });

  it("shows the sum as stated when the weights do not total 100, rather than forcing it", () => {
    const html = render({
      evaluationWeights: field([{ name: "ก", weight: 50 }, { name: "ข", weight: 30 }]),
    });
    expect(html).toContain(">80<");
  });

  it("shows a lowest-price evaluation without a criteria table", () => {
    const html = render({ evaluationMethod: field("lowest_price"), evaluationWeights: field([]) });
    expect(html).toContain("เลือกผู้เสนอราคาต่ำสุด");
    expect(html).not.toContain("<table");
  });

  it("marks an unconfirmed value", () => {
    const html = render({ evaluationMethod: field("lowest_price", { verified: false }) });
    expect(html).toContain("ยังไม่ยืนยัน");
  });

  it("groups required documents by who must hold them, in a fixed order, skipping empty groups", () => {
    const html = render({
      requiredDocuments: field([
        { name: "ใบอนุญาตประกอบวิชาชีพวิศวกรรม", holder: "personnel", certification: "engineer" },
        { name: "หนังสือรับรองบริษัท", holder: "company" },
      ]),
    });
    expect(html.indexOf("เอกสารของบริษัท")).toBeLessThan(html.indexOf("เอกสารของบุคลากร"));
    expect(html).toContain("หนังสือรับรองบริษัท");
    expect(html).toContain("ใบอนุญาตประกอบวิชาชีพวิศวกรรม");
    expect(html).not.toContain("ไม่ระบุว่าของใคร");
  });

  it("ignores malformed entries instead of throwing", () => {
    const html = render({
      evaluationMethod: field("something_new"),
      evaluationWeights: field([{ name: "ก" }, "x", null]),
      requiredDocuments: field([{ name: "เอกสาร", holder: "nobody" }, { name: "ดี", holder: "company" }]),
    });
    expect(html).toContain("ดี");
    expect(html).not.toContain("เอกสาร</li>");
    expect(html).not.toContain("<table");
  });
});
