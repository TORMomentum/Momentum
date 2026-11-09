// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("mode=signup"),
}));
vi.mock("../shared/lib/viewer", () => ({ useViewer: () => ({ signIn: vi.fn() }) }));

import { LoginView } from "./LoginView";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function boxes() {
  return [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
}

function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  return act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function signUp(tickBehaviour: boolean) {
  await type("login-email", "vendor@example.com");
  await type("login-password", "correct-horse-battery");
  const [pdpa, behaviour] = boxes();
  await act(async () => pdpa!.click());
  if (tickBehaviour) await act(async () => behaviour!.click());
  await act(async () => container.querySelector("form")!.requestSubmit());
  return JSON.parse(fetchMock.mock.calls[0]![1].body as string);
}

describe("LoginView sign-up — behaviour consent (TOR-259)", () => {
  it("offers no behaviour box while the feature is off, and never sends the flag", async () => {
    vi.stubEnv("NEXT_PUBLIC_BEHAVIOUR_ENABLED", "false");
    act(() => root.render(<LoginView />));
    expect(boxes()).toHaveLength(1);
    expect(await signUp(false)).toEqual({ email: "vendor@example.com", password: "correct-horse-battery", consent: true });
  });

  it("is optional: signing up with it unticked sends no behaviour consent", async () => {
    vi.stubEnv("NEXT_PUBLIC_BEHAVIOUR_ENABLED", "true");
    act(() => root.render(<LoginView />));
    expect(boxes()).toHaveLength(2);
    expect((await signUp(false)).behaviourConsent).toBeUndefined();
  });

  it("sends behaviourConsent only when ticked", async () => {
    vi.stubEnv("NEXT_PUBLIC_BEHAVIOUR_ENABLED", "true");
    act(() => root.render(<LoginView />));
    expect((await signUp(true)).behaviourConsent).toBe(true);
  });
});
