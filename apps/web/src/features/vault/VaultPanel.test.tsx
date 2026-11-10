// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Vault, VaultDocument } from "../../shared/api/vault.api";
import { VaultPanel } from "./VaultPanel";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const doc = (over: Partial<VaultDocument> = {}): VaultDocument => ({
  id: "d1", kind: "cv", filename: "ประวัติบริษัท.pdf", contentType: "application/pdf", bytes: 2048, uploadedAt: "2026-11-10T03:00:00.000Z", ...over,
});
const vault = (documents: VaultDocument[] = [], limits = { maxFileBytes: 10_485_760, maxFiles: 20 }): Vault => ({ documents, limits });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (initial: Vault | null) => act(async () => root.render(<VaultPanel initial={initial} />));
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
const pick = (file: File) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
});
const choose = (label: string, value: string) => act(async () => {
  const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  set.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
});

describe("VaultPanel", () => {
  it("lists what is kept with its type, size and a download link", async () => {
    await render(vault([doc(), doc({ id: "d2", kind: "certificate", certificationId: "iso-9001", filename: "iso.pdf" })]));
    expect(container.textContent).toContain("ประวัติบริษัท.pdf");
    expect(container.textContent).toContain("ISO 9001");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/api/vault/d1"]')?.hasAttribute("download")).toBe(true);
  });

  it("says plainly when there is nothing yet", async () => {
    await render(vault());
    expect(container.textContent).toContain("ยังไม่มีเอกสาร");
  });

  it("says so when the vault cannot be read, instead of showing an empty one", async () => {
    await render(null);
    expect(container.textContent).toContain("ยังโหลดเอกสารที่เก็บไว้ไม่ได้");
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("uploads the chosen file with its type and the certificate it is, and adds it to the list", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => doc({ id: "new", kind: "certificate", certificationId: "iso-9001", filename: "iso.pdf" }) });
    await render(vault());
    await choose("ประเภทเอกสาร", "certificate");
    await choose("ใบรับรองที่เป็น", "iso-9001");
    await pick(new File(["%PDF-1.4"], "iso.pdf", { type: "application/pdf" }));
    await act(async () => button("อัปโหลด").click());

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/vault");
    const body = fetchMock.mock.calls[0]![1].body as FormData;
    expect(body.get("kind")).toBe("certificate");
    expect(body.get("certificationId")).toBe("iso-9001");
    expect((body.get("file") as File).name).toBe("iso.pdf");
    expect(container.textContent).toContain("iso.pdf");
  });

  it("does not send a file over the size limit, and shows what the API refused with", async () => {
    await render(vault([], { maxFileBytes: 1024, maxFiles: 20 }));
    await pick(new File([new Uint8Array(4096)], "big.pdf"));
    await act(async () => button("อัปโหลด").click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("ไฟล์ใหญ่เกิน");

    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { message: "รับเฉพาะไฟล์ PDF, JPG และ PNG" } }) });
    await pick(new File(["x"], "a.pdf"));
    await act(async () => button("อัปโหลด").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("รับเฉพาะไฟล์ PDF, JPG และ PNG");
  });

  it("deletes only after confirming, and keeps the file when the delete fails", async () => {
    await render(vault([doc()]));
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await act(async () => button("ลบ").click());
    expect(fetchMock).not.toHaveBeenCalled();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValueOnce({ ok: false });
    await act(async () => button("ลบ").click());
    expect(container.textContent).toContain("ประวัติบริษัท.pdf");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("ลบไม่สำเร็จ");

    fetchMock.mockResolvedValueOnce({ ok: true });
    await act(async () => button("ลบ").click());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/vault/d1", { method: "DELETE" });
    expect(container.textContent).not.toContain("ประวัติบริษัท.pdf");
  });

  it("stops offering uploads when the vault is full", async () => {
    await render(vault([doc(), doc({ id: "d2" })], { maxFileBytes: 1024, maxFiles: 2 }));
    expect(container.textContent).toContain("เก็บครบ 2 ไฟล์แล้ว");
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
