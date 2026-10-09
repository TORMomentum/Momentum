// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccountOpen } from "../shared/lib/admin-api";

const actions = vi.hoisted(() => ({
  verify: vi.fn<() => Promise<void>>(),
  reset: vi.fn<() => Promise<void>>(),
}));

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../features/admin/admin-accounts.actions", () => ({
  saveVendorProfileAction: vi.fn(),
  setVendorRoleAction: vi.fn(),
  disableVendorAction: vi.fn(),
  enableVendorAction: vi.fn(),
  sendVerificationEmailAction: actions.verify,
  sendPasswordResetAction: actions.reset,
}));

import { AdminVendorView } from "./AdminVendorView";

function opened(over: Partial<AdminAccountOpen["account"]> = {}): AdminAccountOpen {
  return {
    account: {
      id: "acc-1", email: "vendor@example.test", displayName: "ผู้ขายทดสอบ", role: "vendor",
      verified: true, disabled: false, createdAt: "2026-10-01T00:00:00.000Z",
      hasPassword: true, consentAgreedAt: "2026-10-01T00:00:00.000Z", consentWithdrawnAt: null, ...over,
    },
    profile: { categories: [], areas: ["thailand"], otherCategories: [], budget: null, updatedAt: null },
    audit: [{ action: "viewed", actor: "admin", at: "2026-10-07T12:00:00.000Z" }],
  };
}

/** The account actions row only — the confirm dialogs hold buttons of the same names. */
const labels = (container: HTMLElement) =>
  [...(container.querySelector('[aria-label="จัดการบัญชี"]')?.querySelectorAll("button") ?? [])].map((b) => b.textContent?.trim());

describe("AdminVendorView", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("offers a password reset link for a verified account, never a password field", async () => {
    actions.reset.mockResolvedValue(undefined);
    await act(async () => root.render(<AdminVendorView opened={opened()} />));

    expect(labels(container)).toContain("ส่งลิงก์ตั้งรหัสผ่านใหม่");
    expect(labels(container)).not.toContain("ส่งอีเมลยืนยันอีกครั้ง");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).toContain("เปิดดูบัญชี");

    const reset = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "ส่งลิงก์ตั้งรหัสผ่านใหม่")!;
    await act(async () => reset.click());
    expect(actions.reset).toHaveBeenCalledWith("acc-1");
  });

  it("offers to resend verification for an unverified account, and enable for a disabled one", async () => {
    await act(async () => root.render(<AdminVendorView opened={opened({ verified: false })} />));
    expect(labels(container)).toContain("ส่งอีเมลยืนยันอีกครั้ง");
    expect(labels(container)).not.toContain("ส่งลิงก์ตั้งรหัสผ่านใหม่");

    await act(async () => root.render(<AdminVendorView opened={opened({ disabled: true })} />));
    expect(labels(container)).toContain("เปิดใช้บัญชี");
    expect(labels(container)).not.toContain("ระงับบัญชี");
  });
});
