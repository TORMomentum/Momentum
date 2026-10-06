// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardPayload } from "../shared/api/stats.api";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { DashboardView } from "./DashboardView";

function dashboard(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    totals: { torCount: 1, budgetSum: 1000, agencyCount: 1, unverifiedBudgetCount: 0 },
    flagged: { count: 0 },
    trend: [{ month: "2026-09", torCount: 1, budgetSum: 1000 }],
    byAgency: [{ agency: "หน่วยงานทดสอบ", torCount: 1, budgetSum: 1000 }],
    byState: [
      { state: "open", torCount: 1, budgetSum: 1000 },
      { state: "awaiting-invitation", torCount: 0, budgetSum: 0 },
      { state: "closed", torCount: 0, budgetSum: 0 },
      { state: "awarded", torCount: 0, budgetSum: 0 },
      { state: "cancelled", torCount: 0, budgetSum: 0 },
    ],
    points: [{ id: "tor-1", category: "งานก่อสร้าง", month: "2026-09", budget: 1000, verdict: { kind: "normal" }, confidence: 0.9, verified: true, modelVersion: "model-1" }],
    bounds: [{ category: "งานก่อสร้าง", month: "2026-09", n: 8, q1: 100, q3: 900, lowBound: 0, highBound: 1000, eligible: true }],
    rule: { method: "IQR", iqrMultiplier: 1.5, zScoreLimit: 3, peerMinN: 8, windowMonths: 12, cohortTimezone: "Asia/Bangkok" },
    meta: { lastIntakeAt: "2026-09-01T00:00:00.000Z", statsComputedAt: "2026-09-01T00:00:00.000Z", stale: false, corpusSize: 1 },
    checklist: null,
    ...overrides,
  };
}

describe("DashboardView states", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  async function render(payload: DashboardPayload, category?: string) {
    await act(async () => root.render(<DashboardView dashboard={payload} filters={category ? { category } : {}} />));
  }

  it("renders the empty state", async () => {
    await render(dashboard({ totals: { torCount: 0, budgetSum: 0, agencyCount: 0, unverifiedBudgetCount: 0 }, trend: [], byAgency: [], points: [], bounds: [] }));
    expect(container.textContent).toContain("ยังไม่มี TOR สำหรับตัวกรองนี้");
  });

  it("explains insufficient peers instead of showing a flag", async () => {
    await render(dashboard({ bounds: [{ category: "งานก่อสร้าง", month: "2026-09", n: 3, q1: null, q3: null, lowBound: null, highBound: null, eligible: false }] }), "งานก่อสร้าง");
    expect(container.textContent).toContain("มี TOR ที่เปรียบเทียบได้ไม่เพียงพอ (3/8)");
  });

  it("marks stale figures as recalculating", async () => {
    await render(dashboard({ meta: { lastIntakeAt: null, statsComputedAt: null, stale: true, corpusSize: 1 } }));
    expect(container.textContent).toContain("กำลังคำนวณข้อมูลสถิติใหม่");
  });
});

describe("DashboardView state breakdown", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("names the five states a reader acts on, in the words search uses", () => {
    act(() => root.render(<DashboardView dashboard={dashboard()} filters={{}} />));

    for (const label of ["เปิดรับข้อเสนอ", "รอประกาศเชิญชวน", "ปิดรับแล้ว", "ประกาศผู้ชนะแล้ว", "ยกเลิกแล้ว"]) {
      expect(container.textContent).toContain(label);
    }
  });
});
