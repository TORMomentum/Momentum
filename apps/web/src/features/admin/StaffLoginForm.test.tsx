// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("./staff-login.actions", () => ({ signInAction: vi.fn() }));

import { ViewerProvider } from "../../shared/lib/viewer";
import { StaffLoginForm } from "./StaffLoginForm";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(account: { email: string; name: string; role: "vendor" | "admin" } | null) {
  act(() =>
    root.render(
      <ViewerProvider initialAccount={account}>
        <StaffLoginForm />
      </ViewerProvider>,
    ),
  );
}

describe("StaffLoginForm", () => {
  it("asks for the staff code when nobody is signed in", () => {
    render(null);
    expect(container.querySelector("#staff-secret")).not.toBeNull();
  });

  it("says why the code will not work while a vendor is signed in, and offers to sign out", () => {
    render({ email: "vendor-test@tor-radar.test", name: "ผู้ขาย", role: "vendor" });
    expect(container.querySelector("#staff-secret")).toBeNull();
    expect(container.textContent).toContain("vendor-test@tor-radar.test");

    const signOut = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("ออกจากระบบ"))!;
    act(() => signOut.click());

    // Signed out, the code can be entered.
    expect(container.querySelector("#staff-secret")).not.toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
  });

  it("lets an admin account use the code", () => {
    render({ email: "admin@example.test", name: "ผู้ดูแล", role: "admin" });
    expect(container.querySelector("#staff-secret")).not.toBeNull();
  });
});
