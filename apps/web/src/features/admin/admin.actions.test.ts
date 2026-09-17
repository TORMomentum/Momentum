import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  saveEdits: vi.fn(),
  approve: vi.fn(),
  reextract: vi.fn(),
  reject: vi.fn(),
  setFieldVerification: vi.fn(),
  uploadDocument: vi.fn(),
  fetchEvents: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../shared/lib/staff-session", () => ({
  requireStaff: mocks.requireStaff,
}));
vi.mock("../../shared/lib/admin-api", () => ({
  saveEdits: mocks.saveEdits,
  approve: mocks.approve,
  reextract: mocks.reextract,
  reject: mocks.reject,
  setFieldVerification: mocks.setFieldVerification,
  uploadDocument: mocks.uploadDocument,
  fetchEvents: mocks.fetchEvents,
}));

import {
  approveRecordAction,
  fetchRecentUploadsAction,
  reextractRecordAction,
  rejectRecordAction,
  saveCorrections,
  setFieldVerificationAction,
  uploadDocumentAction,
} from "./admin.actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStaff.mockRejectedValue(new Error("staff authentication required"));
});

describe("admin Server Action authorization", () => {
  it("refuses saveCorrections before calling the admin API", async () => {
    await expect(saveCorrections("tor-1", [])).rejects.toThrow("staff authentication required");
    expect(mocks.saveEdits).not.toHaveBeenCalled();
  });

  it("refuses approveRecordAction before calling the admin API", async () => {
    await expect(approveRecordAction("tor-1", [])).rejects.toThrow(
      "staff authentication required",
    );
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("refuses reextractRecordAction before calling the admin API", async () => {
    await expect(reextractRecordAction("tor-1")).rejects.toThrow(
      "staff authentication required",
    );
    expect(mocks.reextract).not.toHaveBeenCalled();
  });

  it("refuses rejectRecordAction before calling the admin API", async () => {
    await expect(rejectRecordAction("tor-1", "reason")).rejects.toThrow(
      "staff authentication required",
    );
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it("refuses setFieldVerificationAction before calling the admin API", async () => {
    await expect(setFieldVerificationAction("tor-1", "budget", true)).rejects.toThrow(
      "staff authentication required",
    );
    expect(mocks.setFieldVerification).not.toHaveBeenCalled();
  });

  it("refuses uploadDocumentAction before calling the admin API", async () => {
    await expect(
      uploadDocumentAction({ result: null, error: null }, new FormData()),
    ).rejects.toThrow("staff authentication required");
    expect(mocks.uploadDocument).not.toHaveBeenCalled();
  });

  it("refuses fetchRecentUploadsAction before calling the admin API", async () => {
    await expect(fetchRecentUploadsAction()).rejects.toThrow("staff authentication required");
    expect(mocks.fetchEvents).not.toHaveBeenCalled();
  });
});

describe("fetchRecentUploadsAction", () => {
  beforeEach(() => {
    mocks.requireStaff.mockResolvedValue(undefined);
  });

  it("keeps only records that originated from the upload screen", async () => {
    mocks.fetchEvents.mockResolvedValue([
      // Newest first, matching fetchEvents' own ordering.
      { torId: "tor-url", title: "จาก URL", from: "queued", to: "extracting", actor: "worker", source: "worker", at: "2026-09-17T02:00:00Z" },
      { torId: "tor-url", title: "จาก URL", from: null, to: "queued", actor: "admin", source: "url", at: "2026-09-17T01:00:00Z" },
      { torId: "tor-upload", title: "จาก Upload", from: null, to: "queued", actor: "admin", source: "upload", at: "2026-09-17T00:30:00Z" },
    ]);

    const uploads = await fetchRecentUploadsAction();

    expect(uploads).toEqual([{ torId: "tor-upload", title: "จาก Upload", state: "queued", at: "2026-09-17T00:30:00Z" }]);
  });

  it("reports each record's most recent transition, not its founding one", async () => {
    mocks.fetchEvents.mockResolvedValue([
      { torId: "tor-1", title: "TOR 1", from: "extracting", to: "published", actor: "worker", source: "worker", at: "2026-09-17T03:00:00Z" },
      { torId: "tor-1", title: "TOR 1", from: "queued", to: "extracting", actor: "worker", source: "worker", at: "2026-09-17T02:00:00Z" },
      { torId: "tor-1", title: "TOR 1", from: null, to: "queued", actor: "admin", source: "upload", at: "2026-09-17T01:00:00Z" },
    ]);

    const uploads = await fetchRecentUploadsAction();

    expect(uploads).toEqual([{ torId: "tor-1", title: "TOR 1", state: "published", at: "2026-09-17T03:00:00Z" }]);
  });
});

describe("uploadDocumentAction", () => {
  beforeEach(() => {
    mocks.requireStaff.mockResolvedValue(undefined);
  });

  it("rejects a submission with no file, without calling the API", async () => {
    const state = await uploadDocumentAction({ result: null, error: null }, new FormData());

    expect(state.error).toBe("กรุณาเลือกไฟล์ก่อนอัปโหลด");
    expect(mocks.uploadDocument).not.toHaveBeenCalled();
  });

  it("uploads the submitted file and returns the result", async () => {
    const file = new File([Buffer.from("%PDF-1.4")], "tor.pdf", { type: "application/pdf" });
    const formData = new FormData();
    formData.set("file", file);
    mocks.uploadDocument.mockResolvedValue({ torId: "tor-1", duplicate: false, state: "queued" });

    const state = await uploadDocumentAction({ result: null, error: null }, formData);

    expect(mocks.uploadDocument).toHaveBeenCalledWith(file);
    expect(state).toEqual({
      result: { torId: "tor-1", duplicate: false, state: "queued" },
      error: null,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/review");
  });

  it("reports a generic failure without leaking the underlying error to the screen", async () => {
    const file = new File([Buffer.from("%PDF-1.4")], "tor.pdf", { type: "application/pdf" });
    const formData = new FormData();
    formData.set("file", file);
    mocks.uploadDocument.mockRejectedValue(new Error("network is down"));

    const state = await uploadDocumentAction({ result: null, error: null }, formData);

    expect(state).toEqual({ result: null, error: "อัปโหลดไม่สำเร็จ — ลองใหม่อีกครั้ง" });
  });
});

describe("rejectRecordAction reason", () => {
  it("checks the staff session before it checks the reason", async () => {
    await expect(rejectRecordAction("tor-1", "   ")).rejects.toThrow(
      "staff authentication required",
    );
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it("refuses an empty or whitespace-only reason", async () => {
    // Signed in, so the call reaches the reason guard. Authentication is
    // checked first by design: an unauthenticated caller must not learn how
    // the action validates.
    mocks.requireStaff.mockResolvedValue(undefined);

    await expect(rejectRecordAction("tor-1", "   ")).rejects.toThrow(
      "reject reason is required",
    );
    expect(mocks.requireStaff).toHaveBeenCalled();
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it("passes the reviewer's typed reason to the audit-producing API call", async () => {
    mocks.requireStaff.mockResolvedValue(undefined);

    await rejectRecordAction("tor-1", "  เอกสารไม่ตรงกับระเบียนที่นำเข้า  ");

    expect(mocks.reject).toHaveBeenCalledWith(
      "tor-1",
      "เอกสารไม่ตรงกับระเบียนที่นำเข้า",
    );
  });
});
