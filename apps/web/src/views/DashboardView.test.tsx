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
    // It may only say the figures are old. Claiming a recalculation is under
    // way would be false whenever the worker is stopped — which is exactly when
    // a reader sees this.
    expect(container.textContent).toContain("ตัวเลขสถิติอาจยังไม่เป็นปัจจุบัน");
    expect(container.textContent).not.toContain("กำลังคำนวณ");
  });

  it("shows failed checks beside flagged budgets, with the notice and the methodology link (FR-F-4)", async () => {
    await render(dashboard({
      checklist: {
        tors: 12,
        byCheck: [
          { id: "C1", label: "งบประมาณระบุไว้", failed: 0, notEvaluated: 0 },
          { id: "C4", label: "ระบุคุณสมบัติผู้รับจ้าง", failed: 5, notEvaluated: 0 },
          { id: "C5", label: "งบประมาณอยู่ในช่วงปกติของกลุ่มเปรียบเทียบ", failed: 2, notEvaluated: 3 },
        ],
        flagged: [
          { id: "tor-big", title: "ซื้อเครื่องเอกซเรย์", budget: 90_000_000, failed: [{ id: "C4", label: "ระบุคุณสมบัติผู้รับจ้าง" }] },
          { id: "tor-small", title: "ปรับปรุงอาคาร", budget: 5_000_000, failed: [] },
        ],
      },
    }));

    const panel = container.querySelector('[aria-labelledby="dashboard-checklist-title"]');
    expect(panel?.textContent).toContain("จาก TOR 12 ฉบับในกราฟ");
    const row = [...(panel?.querySelectorAll("tbody tr") ?? [])].find((tr) => tr.textContent?.includes("ระบุคุณสมบัติผู้รับจ้าง"));
    // Passed is what is left of the 12 once the failures and the unevaluated are taken out.
    expect([...(row?.querySelectorAll("td") ?? [])].map((td) => td.textContent)).toEqual(["7", "5", "0"]);

    // Each flagged budget is named, links to its TOR, and says which other checks it failed.
    const items = [...(panel?.querySelectorAll("li") ?? [])];
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector('a[href="/tors/tor-big"]')?.textContent).toBe("ซื้อเครื่องเอกซเรย์");
    expect(items[0]?.textContent).toContain("ไม่ผ่าน: ระบุคุณสมบัติผู้รับจ้าง");
    expect(items[1]?.textContent).toContain("ไม่มีข้ออื่นที่ไม่ผ่าน");

    expect(panel?.textContent).toContain("AI-generated specification-quality check — not a legal or corruption judgment");
    expect(panel?.querySelector('a[href="/methodology"]')).not.toBeNull();
  });

  it("lists the ten agencies with the largest budgets, keeps a picked one, and expands to all", async () => {
    const byAgency = Array.from({ length: 12 }, (_, i) => ({ agency: `หน่วยงาน ${i + 1}`, torCount: 1, budgetSum: (i + 1) * 1000 }));
    // The bar's first label span holds the agency's name alone.
    const names = () => [...container.querySelectorAll("button[aria-pressed]")]
      .map((b) => b.querySelector("span > span")?.textContent ?? "")
      .filter((t) => t.startsWith("หน่วยงาน "));

    await render(dashboard({ byAgency }));
    expect(names()).toHaveLength(10);
    expect(names()[0]).toBe("หน่วยงาน 12");
    expect(names()).not.toContain("หน่วยงาน 1");

    const more = [...container.querySelectorAll("button")].find((b) => b.textContent === "ดูทั้งหมด (12 หน่วยงาน)");
    await act(async () => more?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(names()).toHaveLength(12);

    // Collapsed again, an agency picked below the cut still shows.
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<DashboardView dashboard={dashboard({ byAgency })} filters={{ agency: "หน่วยงาน 1" }} />));
    expect(names()).toHaveLength(11);
    expect(names()).toContain("หน่วยงาน 1");
  });

  it("shows no checklist panel when the API sends none", async () => {
    await render(dashboard());
    expect(container.querySelector('[aria-labelledby="dashboard-checklist-title"]')).toBeNull();
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
