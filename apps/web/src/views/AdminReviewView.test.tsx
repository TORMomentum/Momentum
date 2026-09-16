// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewRecord } from "../shared/lib/admin-api";

const actions = vi.hoisted(() => ({
  approve: vi.fn<() => Promise<void>>(),
  reextract: vi.fn<() => Promise<void>>(),
  reject: vi.fn<() => Promise<void>>(),
  setFieldVerification: vi.fn<() => Promise<void>>(),
}));

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../features/admin/admin.actions", () => ({
  approveRecordAction: actions.approve,
  reextractRecordAction: actions.reextract,
  rejectRecordAction: actions.reject,
  setFieldVerificationAction: actions.setFieldVerification,
}));

import { AdminReviewView } from "./AdminReviewView";

const FIELD_KEYS = [
  "title",
  "agency",
  "budget",
  "deadline",
  "category",
  "scopeSummary",
  "qualifications",
  "contact",
  "torStatus",
];

function makeRecord(verified: boolean): ReviewRecord {
  return {
    id: "tor-1",
    title: "โครงการทดสอบ",
    agency: "หน่วยงานทดสอบ",
    confidence: 0.5,
    reviewReasons: ["budget-missing"],
    route: "upload",
    submittedAt: "2026-09-11T00:00:00.000Z",
    contentType: "application/pdf",
    fields: Object.fromEntries(FIELD_KEYS.map((key) => [key, {
      raw: `${key} value`,
      value: `${key} value`,
      confidence: 0.5,
      verified,
    }])),
    storage: { key: "documents/tor-1.pdf", contentType: "application/pdf", bytes: 100 },
    hasTextLayer: true,
    sourceUrl: null,
    contentHash: "0123456789abcdef",
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

describe("AdminReviewView confirmations", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    actions.approve.mockResolvedValue(undefined);
    actions.reextract.mockResolvedValue(undefined);
    actions.reject.mockResolvedValue(undefined);
    actions.setFieldVerification.mockResolvedValue(undefined);

    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) { this.setAttribute("open", ""); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) { this.removeAttribute("open"); },
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(verified: boolean) {
    const record = makeRecord(verified);
    await act(async () => {
      root.render(
        <AdminReviewView
          queue={[record]}
          unverifiedNotQueued={0}
          record={record}
          documentHref={null}
          offline={null}
        />,
      );
    });
  }

  it("does not allow rejection without a reason and passes the typed reason through", async () => {
    await render(false);

    await act(async () => button(container, "ปฏิเสธ").click());
    const dialog = container.querySelector("dialog[open]");
    expect(dialog).not.toBeNull();

    const confirm = button(dialog as HTMLElement, "ปฏิเสธ");
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(actions.reject).not.toHaveBeenCalled();

    const textarea = dialog?.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("reason textarea not found");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, "  เหตุผลจากผู้ตรวจสอบ  ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => button(dialog as HTMLElement, "ปฏิเสธ").click());
    expect(actions.reject).toHaveBeenCalledWith("tor-1", "เหตุผลจากผู้ตรวจสอบ");
  });

  it("approves immediately when all fields are confirmed", async () => {
    await render(true);

    await act(async () => button(container, "ยืนยันและเผยแพร่").click());

    expect(actions.approve).toHaveBeenCalledWith("tor-1", []);
    expect(container.querySelector("dialog[open]")).toBeNull();
  });

  it("prompts before approval when fields remain unconfirmed", async () => {
    await render(false);

    await act(async () => button(container, "ยืนยันและเผยแพร่").click());

    expect(actions.approve).not.toHaveBeenCalled();
    const dialog = container.querySelector("dialog[open]");
    expect(dialog?.textContent).toContain("ยังมี 9 ฟิลด์ที่ไม่ได้ยืนยัน");
  });
});
