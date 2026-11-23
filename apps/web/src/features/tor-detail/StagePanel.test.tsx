// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectStageEntry } from "@tor-radar/shared";
import type { OriginalDocument } from "./OriginalPreview";
import { StagePanel, stagesInOrder } from "./StagePanel";

const TOR = "6b03fd1a1e1b2d59a19b90fa";
const INVITATION = "6b03fd1a1e1b2d59a19b90fb";
const doc = (key: OriginalDocument["key"], href: string): OriginalDocument => ({
  key,
  label: key,
  href,
  inlineUrl: href,
  downloadUrl: href,
  contentHash: null,
  contentType: null,
});
const ORIGINALS = [doc("tor", `/tors/${TOR}/original`), doc("invitation", `/tors/${TOR}/original?doc=invitation`)];

// e-GP's own order for project 69069300968: not date order.
const STAGES: ProjectStageEntry[] = [
  { code: "B3", kind: "draft", description: "ร่างเอกสารประกวดราคา(e-Bidding)", on: "2026-08-17", recordId: TOR },
  { code: "BOQ", kind: "median-price", description: null, on: "2026-08-24" },
  { code: "price", kind: "other", description: "สรุปข้อมูลการเสนอราคาเบื้องต้น", on: "2026-09-10" },
  { code: "D0", kind: "invitation", description: "ประกาศเชิญชวน", on: "2026-08-24", recordId: INVITATION },
  { code: "D1", kind: "cancelled", description: "ยกเลิกประกาศเชิญชวน", on: "2026-11-23" },
];

const render = (props: Partial<Parameters<typeof StagePanel>[0]> = {}) =>
  renderToStaticMarkup(
    <StagePanel
      torId={TOR}
      stages={STAGES}
      current={{ code: "D1", kind: "cancelled", on: "2026-11-23" }}
      checkedAt="2026-11-24T01:10:00Z"
      projectUrl="https://process5.gprocurement.go.th/egp-agpc01-web/announcement?keywordSearch=69069300968"
      originals={ORIGINALS}
      title="จ้างก่อสร้างอาคาร"
      {...props}
    />,
  );

describe("StagePanel (TOR-206)", () => {
  it("renders nothing for a record with no stages read", () => {
    expect(render({ stages: [] })).toBe("");
    expect(render({ stages: undefined })).toBe("");
  });

  it("orders stages by day, keeping the source's order on a tie", () => {
    expect(stagesInOrder(STAGES).map((stage) => stage.code)).toEqual(["B3", "BOQ", "D0", "price", "D1"]);
  });

  it("shows each stage by the source's own name with its Thai day, never its code", () => {
    const html = render();
    expect(html).toContain("ร่างเอกสารประกวดราคา(e-Bidding)");
    expect(html).toContain("สรุปข้อมูลการเสนอราคาเบื้องต้น");
    // BOQ is unnamed by e-GP: our Thai name for its kind.
    expect(html).toContain("ประกาศราคากลาง");
    expect(html).toContain("17 ส.ค. 2569");
    expect(html).toContain("23 พ.ย. 2569");
    for (const code of [">B3<", ">BOQ<", ">D0<", ">D1<", ">price<"]) expect(html).not.toContain(code);
  });

  it("marks the newest stage as current, with a tag when it is final", () => {
    const html = render();
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("ยกเลิก</span>");
    const open = render({ stages: STAGES.slice(0, 4), current: { code: "price", kind: "other", on: "2026-09-10" } });
    expect(open).toContain("ขั้นตอนปัจจุบัน");
    expect(open).not.toContain("ได้ผู้ชนะแล้ว");
  });

  it("links a stage to its document when we hold it, and the project on e-GP for the rest", () => {
    const html = render();
    expect(html).toContain(`href="/tors/${TOR}/original"`);
    expect(html).toContain(`href="/tors/${TOR}/original?doc=invitation"`);
    expect(html.match(/ดูเอกสาร</g)).toHaveLength(2);
    expect(html).toContain("ดูทุกประกาศของโครงการใน e-GP");
    expect(html).toContain("keywordSearch=69069300968");
    expect(html).toContain("ตรวจล่าสุด 24 พ.ย. 2569 · 08:10");
  });

  it("does not link an invitation the reader cannot open", () => {
    const html = render({ originals: ORIGINALS.slice(0, 1) });
    expect(html.match(/ดูเอกสาร</g)).toHaveLength(1);
  });
});
