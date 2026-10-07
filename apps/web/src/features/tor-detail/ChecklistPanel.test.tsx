// @vitest-environment node

import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Checklist } from "@tor-radar/shared";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { ChecklistPanel } from "./ChecklistPanel";

const checklist: Checklist = {
  passed: 1,
  evaluated: 2,
  checks: [
    { id: "C1", label: "งบประมาณระบุไว้", result: "pass", reason: "ระบุงบประมาณและยืนยันแล้ว" },
    { id: "C2", label: "ระยะเวลายื่นข้อเสนอเพียงพอ", result: "not-evaluated", reason: "ยังไม่ประเมิน: เหตุผล C2" },
    { id: "C3", label: "ขอบเขตงานเจาะจง", result: "not-evaluated", reason: "ยังไม่ประเมิน: เหตุผล C3" },
    { id: "C4", label: "ระบุคุณสมบัติผู้รับจ้าง", result: "fail", reason: "ไม่พบคุณสมบัติที่จับคู่กับอนุกรมวิธานได้" },
    { id: "C5", label: "งบประมาณอยู่ในช่วงปกติของกลุ่มเปรียบเทียบ", result: "not-evaluated", reason: "ยังไม่ประเมินการเปรียบเทียบงบประมาณ" },
  ],
};

describe("ChecklistPanel", () => {
  const html = renderToStaticMarkup(<ChecklistPanel checklist={checklist} />);

  it("carries the required AI-generated label verbatim", () => {
    expect(html).toContain("AI-generated specification-quality check — not a legal or corruption judgment");
  });

  it("states the score over the evaluated checks only", () => {
    expect(html).toContain("ผ่าน 1 จาก 2 ข้อที่ประเมินได้");
  });

  it("shows every check with its reason", () => {
    for (const check of checklist.checks) {
      expect(html).toContain(check.label);
      expect(html).toContain(check.reason);
    }
  });

  it("links to the methodology page", () => {
    expect(html).toContain('href="/methodology"');
  });
});
