import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  saveEdits: vi.fn(),
  approve: vi.fn(),
  reextract: vi.fn(),
  reject: vi.fn(),
  setFieldVerification: vi.fn(),
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
}));

import {
  approveRecordAction,
  reextractRecordAction,
  rejectRecordAction,
  saveCorrections,
  setFieldVerificationAction,
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
});
