// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdminSource, AdminSources } from "../../shared/lib/admin-api";
import { SourceHealthTable } from "./SourceHealthTable";

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

const source = (extra: Partial<AdminSource>): AdminSource => ({
  id: "national-egp-stages",
  name: "e-GP — ขั้นตอนโครงการ",
  kind: "automatic",
  status: "ok",
  lastSeenAt: "2026-11-24T02:00:00.000Z",
  lastSuccessAt: "2026-11-24T02:00:00.000Z",
  lastFailureAt: null,
  lastError: null,
  consecutiveFailures: 0,
  lastRun: { at: "2026-11-24T02:00:00.000Z", items: 12, failed: 0 },
  records: 991,
  latestRecordAt: "2026-11-24T02:00:00.000Z",
  alertSentAt: null,
  ...extra,
});

const data: AdminSources = {
  checkedAt: "2026-11-24T03:00:00.000Z",
  settings: { alertFailures: 3, staleHours: 48 },
  sources: [
    source({}),
    source({
      id: "national-egp-import",
      name: "e-GP — นำเข้า TOR",
      kind: "manual",
      status: "failing",
      lastFailureAt: "2026-11-23T10:00:00.000Z",
      lastError: "e-GP list unavailable: status 503",
      consecutiveFailures: 1,
      lastRun: { at: "2026-11-23T10:00:00.000Z", items: 0, failed: 0 },
      records: 1013,
    }),
    source({
      id: "bma-egp-import",
      name: "e-GP กรุงเทพมหานคร — นำเข้า TOR",
      kind: "manual",
      status: "never",
      lastSeenAt: null,
      lastSuccessAt: null,
      lastRun: null,
      records: 0,
      latestRecordAt: null,
    }),
    source({ id: "stale", status: "stale", alertSentAt: "2026-11-24T01:00:00.000Z" }),
  ],
};

const row = (id: string) => container.querySelector(`tr[data-source="${id}"]`)!;

describe("SourceHealthTable (TOR-293)", () => {
  it("shows each source's status in Thai, its kind, last success, failure with its reason, and counts", () => {
    act(() => root.render(<SourceHealthTable data={data} />));

    expect(row("national-egp-stages").textContent).toContain("ปกติ");
    expect(row("national-egp-stages").textContent).toContain("ทำงานอัตโนมัติ");
    expect(row("national-egp-stages").textContent).toContain("24 พ.ย. 2569 · 09:00");
    expect(row("national-egp-stages").textContent).toContain("12 โครงการ");
    expect(row("national-egp-stages").textContent).toContain("991");

    expect(row("national-egp-import").textContent).toContain("ล้มเหลวต่อเนื่อง");
    expect(row("national-egp-import").textContent).toContain("รันด้วยมือ");
    expect(row("national-egp-import").textContent).toContain("e-GP list unavailable: status 503");
    expect(row("national-egp-import").textContent).toContain("1,013");

    expect(row("bma-egp-import").textContent).toContain("ยังไม่เคยทำงาน");
    expect(row("stale").textContent).toContain("ไม่ได้อัปเดตเกินกำหนด");
    expect(row("stale").textContent).toContain("แจ้งผู้ดูแลแล้ว 24 พ.ย. 2569 · 08:00");
  });

  it("states the thresholds the statuses come from", () => {
    act(() => root.render(<SourceHealthTable data={data} />));
    expect(container.textContent).toContain("ล้มเหลวติดกัน 3 รอบ");
    expect(container.textContent).toContain("เกิน 48 ชั่วโมง");
  });
});
