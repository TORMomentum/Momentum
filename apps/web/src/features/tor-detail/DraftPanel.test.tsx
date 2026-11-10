// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftPanel } from "./DraftPanel";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

const render = () => act(async () => root.render(<DraftPanel torId="t1" />));
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
const textarea = () => container.querySelector("textarea")!;
const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const type = (value: string) => act(async () => {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  set.call(textarea(), value);
  textarea().dispatchEvent(new Event("input", { bubbles: true }));
});
const generate = async (text = "เรียน [ชื่อบริษัท]") => {
  fetchMock.mockResolvedValueOnce(answer({ text, modelVersion: "gemini-test-001" }));
  await act(async () => button("ให้ AI ร่างจดหมาย").click());
};

describe("DraftPanel", () => {
  it("says what is sent before anything is, and asks for nothing until the button is pressed", async () => {
    await render();
    expect(container.textContent).toContain("ส่งโปรไฟล์ของคุณ");
    expect(container.textContent).toContain("ไม่ส่งตัวไฟล์");
    expect(container.textContent).toContain("ไม่เก็บร่างไว้");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the server for this TOR's draft and shows it as AI's, with the model, in an editable box", async () => {
    await render();
    await generate();

    expect(fetchMock).toHaveBeenCalledWith("/api/tors/t1/draft", { method: "POST" });
    expect(textarea().value).toBe("เรียน [ชื่อบริษัท]");
    expect(container.textContent).toContain("ร่างโดย AI (โมเดล gemini-test-001)");
  });

  it("will not download until the vendor confirms, and an edit takes the confirmation back", async () => {
    await render();
    await generate();
    expect(button("ดาวน์โหลด (.txt)").disabled).toBe(true);

    await act(async () => checkbox().click());
    expect(button("ดาวน์โหลด (.txt)").disabled).toBe(false);

    await type("เรียน ท่าน (แก้แล้ว)");
    expect(checkbox().checked).toBe(false);
    expect(button("ดาวน์โหลด (.txt)").disabled).toBe(true);
  });

  it("downloads exactly the text on screen, edits included", async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await render();
    await generate();
    await type("จดหมายที่แก้แล้ว");
    await act(async () => checkbox().click());

    await act(async () => button("ดาวน์โหลด (.txt)").click());

    expect(blobs).toHaveLength(1);
    // jsdom's Blob has no text(); read it the way a browser would hand it to a file.
    const read = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]!, "utf-8");
    });
    expect(read.replace(/^\uFEFF/, "")).toBe("จดหมายที่แก้แล้ว");
    expect(blobs[0]!.type).toBe("text/plain;charset=utf-8");
  });

  it("shows the server's own words when it refuses, and keeps the button to try again", async () => {
    await render();
    fetchMock.mockResolvedValueOnce(answer({ error: { code: "profile_needed", message: "กรุณากรอกโปรไฟล์ (งานที่รับ) ก่อนให้ AI ร่างจดหมาย" } }, 409));
    await act(async () => button("ให้ AI ร่างจดหมาย").click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("กรุณากรอกโปรไฟล์");
    expect(button("ให้ AI ร่างจดหมาย")).toBeTruthy();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("falls back to a plain message when the network fails", async () => {
    await render();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => button("ให้ AI ร่างจดหมาย").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("ไม่สำเร็จ");
  });

  it("does not throw away the vendor's edits when asked to draft again, unless they agree", async () => {
    await render();
    await generate();
    await type("ข้อความที่ฉันแก้เอง");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await act(async () => button("ร่างใหม่").click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("ข้อความที่ฉันแก้เอง");

    fetchMock.mockResolvedValueOnce(answer({ text: "ร่างใหม่", modelVersion: "m" }));
    await act(async () => button("ร่างใหม่").click());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(textarea().value).toBe("ร่างใหม่");
    expect(checkbox().checked).toBe(false);
  });
});
