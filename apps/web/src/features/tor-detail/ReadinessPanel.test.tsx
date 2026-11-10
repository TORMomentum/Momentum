// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TorDetailField } from "../../shared/api/tors.api";
import type { Vault, VaultDocument } from "../../shared/api/vault.api";
import { ReadinessPanel } from "./ReadinessPanel";
import { readinessOf } from "./readiness";

const field = (value: unknown, verified = true): TorDetailField => ({ raw: "", value, confidence: 0.9, verified });
const file = (id: string, extra: Partial<VaultDocument> = {}): VaultDocument => ({
  id, kind: "certificate", certificationId: "iso-9001", filename: "iso.pdf", contentType: "application/pdf", bytes: 10, uploadedAt: "2026-11-10T00:00:00.000Z", ...extra,
});
const vault = (...documents: VaultDocument[]): Vault => ({ documents, limits: { maxFileBytes: 1, maxFiles: 1 } });
const render = (required: unknown, v: Vault | null, verified = true) =>
  renderToStaticMarkup(<ReadinessPanel requiredDocuments={field(required, verified)} vault={v} />);

describe("readinessOf", () => {
  const iso = { name: "ISO 9001", holder: "company" as const, certification: "iso-9001" };

  it("has a listed certification when the vault holds a certificate the vendor marked as it", () => {
    const [row] = readinessOf([iso], [file("a")]);
    expect(row).toMatchObject({ status: "have", file: { id: "a" } });
  });

  it("is missing when no certificate is marked as it, whatever else is kept", () => {
    const others = [file("b", { certificationId: "iso-14001" }), file("c", { kind: "cv", certificationId: undefined }), file("d", { kind: "past_work" })];
    expect(readinessOf([iso], others)[0]!.status).toBe("missing");
  });

  it("does not count a file of another kind that carries the id", () => {
    expect(readinessOf([iso], [file("e", { kind: "past_work" })])[0]!.status).toBe("missing");
  });

  it("leaves a document that names no listed certification to the vendor, never guessing from its words", () => {
    const [row] = readinessOf([{ name: "ISO 9001 CV", holder: "company" }], [file("a")]);
    expect(row!.status).toBe("manual");
  });
});

describe("ReadinessPanel", () => {
  const required = [
    { name: "ISO 9001", holder: "company", certification: "iso-9001" },
    { name: "ใบอนุญาตวิศวกร", holder: "personnel", certification: "engineer" },
    { name: "หนังสือรับรองผลงาน", holder: "company" },
  ];

  it("shows what is there, what is missing and what only the vendor can check", () => {
    const html = render(required, vault(file("a")));
    expect(html).toContain("ความพร้อมของเอกสารคุณ");
    expect(html).toContain("มีแล้ว 1 จาก 2 รายการที่ตรวจได้");
    expect(html).toContain("อีก 1 รายการต้องตรวจเอง");
    expect(html).toContain('href="/api/vault/a"');
    expect(html).toContain("iso.pdf");
    expect(html).toContain("ยังไม่มีไฟล์");
    expect(html).toContain('href="/profile"');
    expect(html).toContain("ระบบเทียบให้ไม่ได้ กรุณาตรวจเอง");
  });

  it("says when the list of required documents is itself unconfirmed", () => {
    expect(render(required, vault(), false)).toContain("รายการเอกสารยังไม่ยืนยัน");
    expect(render(required, vault(), true)).not.toContain("รายการเอกสารยังไม่ยืนยัน");
  });

  it("is not shown to someone without a vault, nor for a TOR that requires nothing", () => {
    expect(render(required, null)).toBe("");
    expect(render([], vault(file("a")))).toBe("");
    expect(renderToStaticMarkup(<ReadinessPanel vault={vault()} />)).toBe("");
  });
});
