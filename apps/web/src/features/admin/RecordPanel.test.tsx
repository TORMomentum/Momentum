// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewRecord } from "../../shared/lib/admin-api";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./admin.actions", () => ({
  approveRecordAction: vi.fn(),
  reextractRecordAction: vi.fn(),
  rejectRecordAction: vi.fn(),
  restoreRecordAction: vi.fn(),
  saveCorrections: vi.fn(),
  setFieldVerificationAction: vi.fn(),
}));

import { RecordPanel } from "./RecordPanel";
import { AdminReviewView } from "../../views/AdminReviewView";
import { AdminTorRecordView } from "../../views/AdminTorRecordView";

function record(id: string, title: string, restricted = false): ReviewRecord {
  return {
    id,
    title,
    agency: "หน่วยงาน",
    confidence: 0.5,
    reviewReasons: [],
    route: "upload",
    submittedAt: "2026-10-01T00:00:00.000Z",
    contentType: "application/pdf",
    fields: { title: { raw: title, value: title, confidence: 0.5, verified: false } },
    storage: { key: `${id}.pdf`, contentType: "application/pdf", bytes: 100 },
    hasTextLayer: true,
    sourceUrl: null,
    contentHash: "0123456789abcdef",
    restricted,
  };
}

describe("RecordPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /**
   * The reported bug: typed values were remembered by FIELD NAME, so when a
   * screen moved to another TOR without remounting, record A's typing stayed in
   * record B's boxes while the document moved on. Each screen keys the panel by
   * record id to prevent it.
   *
   * These render the SCREENS, not the panel with a key supplied here — a test
   * that passes the key itself cannot fail, whatever the screens do. Rendering
   * a screen twice on one root keeps the same instance, exactly as navigating
   * between records does, so a screen that drops its key fails this.
   */
  async function typeInto(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  // The record's own title box. Not "the first input": the review screen puts
  // its queue search above the fields, and that search is meant to persist.
  const titleField = () =>
    [...container.querySelectorAll("input")].find((input) => input.closest("[data-record-panel]")) as HTMLInputElement;

  it("does not carry typing from one TOR to the next on the All-TORs record screen", async () => {
    const a = record("a", "ค่า A");
    const b = record("b", "ค่า B");
    const query = { status: "all" as const, kind: "tor" as const, page: 1 };
    await act(async () => { root.render(<AdminTorRecordView record={a} documentHref={null} query={query} />); });
    await typeInto(titleField(), "แก้ไข A");
    expect(titleField().value).toBe("แก้ไข A");

    await act(async () => { root.render(<AdminTorRecordView record={b} documentHref={null} query={query} />); });

    expect(titleField().value).toBe("ค่า B");
  });

  it("does not carry typing from one TOR to the next in the review queue", async () => {
    const a = record("a", "ค่า A");
    const b = record("b", "ค่า B");
    const view = (current: ReviewRecord) => (
      <AdminReviewView queue={[]} unverifiedNotQueued={0} record={current} documentHref={null} offline={null} />
    );
    await act(async () => { root.render(view(a)); });
    await typeInto(titleField(), "แก้ไข A");

    await act(async () => { root.render(view(b)); });

    expect(titleField().value).toBe("ค่า B");
  });

  it("uses management actions without approve-and-publish wording, while review offers approve", async () => {
    const item = record("a", "ค่า A");
    await act(async () => {
      root.render(<RecordPanel key={item.id} record={item} documentHref={null} mode="manage" />);
    });
    expect(container.textContent).toContain("สกัดใหม่");
    expect(container.textContent).toContain("ถอดจากหน้าสาธารณะ");
    expect(container.textContent).not.toContain("ยืนยันและเผยแพร่");
    await act(async () => {
      root.render(<RecordPanel key={item.id} record={item} documentHref={null} mode="review" />);
    });
    expect(container.textContent).toContain("ยืนยันและเผยแพร่");
  });

  it("offers restore instead of take down for a taken-down managed record", async () => {
    const item = record("a", "ค่า A", true);
    await act(async () => {
      root.render(<RecordPanel key={item.id} record={item} documentHref={null} mode="manage" />);
    });
    expect(container.textContent).toContain("คืนสู่หน้าสาธารณะ");
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "ถอดจากหน้าสาธารณะ"),
    ).toBe(false);
  });
});
