import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TorDetail } from "../shared/api/tors.api";
import type { OriginalDocument } from "../features/tor-detail/OriginalPreview";

vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));

import { TorRecordView } from "./TorRecordView";

function tor(overrides: Partial<TorDetail> = {}): TorDetail {
  return {
    id: "tor-1",
    fields: { title: { raw: "ซื้อเครื่องเอกซเรย์", value: "ซื้อเครื่องเอกซเรย์", confidence: 1, verified: true } },
    announcedAt: null,
    sourceUrl: null,
    provenance: null,
    confidenceLevel: "high",
    unverified: false,
    contentHash: "abc",
    contentType: "application/pdf",
    ...overrides,
  };
}

// The page always has at least its own TOR to open.
const original = {
  key: "tor",
  label: "TOR",
  href: "/tors/tor-1/original",
  inlineUrl: "/api/tors/tor-1/document?inline=1",
  downloadUrl: "/api/tors/tor-1/document",
  contentHash: "abc",
  contentType: "application/pdf",
} satisfies OriginalDocument;

const render = (detail: TorDetail) => renderToStaticMarkup(<TorRecordView tor={detail} originals={[original]} />);

describe("TorRecordView category", () => {
  it("shows the category on the closed list, with the document's own wording beneath it", () => {
    const html = render(tor({
      fields: {
        title: { raw: "ซื้อครุภัณฑ์สำนักงานและครุภัณฑ์คอมพิวเตอร์", value: "ซื้อครุภัณฑ์สำนักงานและครุภัณฑ์คอมพิวเตอร์", confidence: 1, verified: true },
        category: { raw: "ครุภัณฑ์สำนักงานและครุภัณฑ์คอมพิวเตอร์", value: "ซื้อคอมพิวเตอร์และอุปกรณ์ไอที", confidence: 0.9, verified: false },
      },
    }));

    expect(html).toContain("ซื้อคอมพิวเตอร์และอุปกรณ์ไอที");
    expect(html).toMatch(/จัดหมวดจาก: “(<!-- -->)?ครุภัณฑ์สำนักงานและครุภัณฑ์คอมพิวเตอร์/);
  });
});
