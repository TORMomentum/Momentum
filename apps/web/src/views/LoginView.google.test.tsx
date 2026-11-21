// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let query = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock("../shared/lib/viewer", () => ({ useViewer: () => ({ signIn: vi.fn() }) }));

import { LoginView } from "./LoginView";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  query = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const googleLink = () => container.querySelector<HTMLAnchorElement>('a[href="/api/auth/google/start"]');

describe("LoginView — Sign in with Google (TOR-315)", () => {
  it("shows no Google button unless sign-in with Google is enabled", () => {
    act(() => root.render(<LoginView />));
    expect(googleLink()).toBeNull();
    expect(container.textContent).not.toContain("Google");
  });

  it("shows a link that leaves for the start route when enabled", () => {
    act(() => root.render(<LoginView googleEnabled />));
    expect(googleLink()?.textContent).toContain("เข้าสู่ระบบด้วย Google");
  });

  it("explains a failed Google sign-in in Thai, without saying why", () => {
    query = "error=google";
    act(() => root.render(<LoginView googleEnabled />));
    expect(container.textContent).toContain("ไม่สามารถเข้าสู่ระบบด้วย Google ได้");
  });
});
