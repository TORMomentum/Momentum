"use client";

import { useRef, useState } from "react";
import { CERTIFICATIONS } from "@tor-radar/seeds";
import type { Vault, VaultDocument, VaultKind } from "../../shared/api/vault.api";
import { formatThaiDate } from "../../shared/lib/format";
import styles from "./vault.module.css";

const KIND_LABELS: Record<VaultKind, string> = {
  cv: "ประวัติบริษัท / CV",
  certificate: "ใบรับรอง",
  past_work: "ผลงานที่ผ่านมา",
};
const KINDS = Object.keys(KIND_LABELS) as VaultKind[];

const ERROR_FALLBACK = "อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง";

function sizeLabel(bytes: number): string {
  return bytes >= 1_048_576 ? `${Number((bytes / 1_048_576).toFixed(1))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The text the API gave for a refusal; its messages are already Thai and written for the vendor. */
async function messageOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    return typeof body.error?.message === "string" ? body.error.message : ERROR_FALLBACK;
  } catch {
    return ERROR_FALLBACK;
  }
}

/**
 * The vendor's own files, kept once and reused for every TOR (TOR-218): who they are (CV), what they hold
 * (certificates) and what they have done (past work). Only the vendor sees them, and nothing here reads them:
 * the vendor says what each file is.
 */
export function VaultPanel({ initial }: { initial: Vault | null }) {
  const [docs, setDocs] = useState<VaultDocument[]>(initial?.documents ?? []);
  const [kind, setKind] = useState<VaultKind>("cv");
  const [certificationId, setCertificationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (initial === null) {
    return (
      <section className={styles.vault} aria-labelledby="vault-title">
        <h2 id="vault-title" className={styles.title}>เอกสารของคุณ</h2>
        <p className={styles.note}>ยังโหลดเอกสารที่เก็บไว้ไม่ได้ในขณะนี้ ลองรีเฟรชหน้านี้</p>
      </section>
    );
  }

  const { maxFileBytes, maxFiles } = initial.limits;
  const full = docs.length >= maxFiles;

  async function upload() {
    const file = fileInput.current?.files?.[0];
    if (!file) { setMessage("กรุณาเลือกไฟล์"); return; }
    if (file.size > maxFileBytes) { setMessage(`ไฟล์ใหญ่เกิน ${sizeLabel(maxFileBytes)}`); return; }
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("kind", kind);
      if (kind === "certificate" && certificationId) form.set("certificationId", certificationId);
      form.set("file", file);
      const response = await fetch("/api/vault", { method: "POST", body: form });
      if (!response.ok) { setMessage(await messageOf(response)); return; }
      const created = (await response.json()) as VaultDocument;
      setDocs((current) => [created, ...current]);
      if (fileInput.current) fileInput.current.value = "";
      setCertificationId("");
    } catch {
      setMessage(ERROR_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: VaultDocument) {
    if (!window.confirm(`ลบ "${doc.filename}" ออกจากเอกสารของคุณ?`)) return;
    setMessage(null);
    try {
      const response = await fetch(`/api/vault/${encodeURIComponent(doc.id)}`, { method: "DELETE" });
      if (!response.ok) { setMessage("ลบไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
      setDocs((current) => current.filter((item) => item.id !== doc.id));
    } catch {
      setMessage("ลบไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  }

  const certificateName = (id?: string) => CERTIFICATIONS.find((item) => item.id === id)?.th;

  return (
    <section className={styles.vault} aria-labelledby="vault-title">
      <h2 id="vault-title" className={styles.title}>เอกสารของคุณ</h2>
      <p className={styles.note}>
        เก็บไว้ครั้งเดียวแล้วใช้กับทุก TOR ที่สนใจ เฉพาะคุณเท่านั้นที่เห็นและโหลดได้ ลบเมื่อไหร่ก็ได้ และจะถูกลบทั้งหมดเมื่อคุณลบบัญชี
        รับไฟล์ PDF, JPG, PNG ไม่เกิน {sizeLabel(maxFileBytes)} เก็บได้สูงสุด {maxFiles} ไฟล์
      </p>

      {docs.length === 0 ? (
        <p className={styles.empty}>ยังไม่มีเอกสาร</p>
      ) : (
        <ul className={styles.list}>
          {docs.map((doc) => (
            <li className={styles.row} key={doc.id}>
              <div className={styles.rowMain}>
                <a className={styles.name} href={`/api/vault/${encodeURIComponent(doc.id)}`} download>{doc.filename}</a>
                <div className={styles.meta}>
                  {KIND_LABELS[doc.kind]}
                  {doc.kind === "certificate" && certificateName(doc.certificationId) ? ` · ${certificateName(doc.certificationId)}` : ""}
                  {` · ${sizeLabel(doc.bytes)} · ${formatThaiDate(doc.uploadedAt)}`}
                </div>
              </div>
              <button type="button" className={styles.remove} onClick={() => void remove(doc)}>ลบ</button>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className={styles.note}>เก็บครบ {maxFiles} ไฟล์แล้ว ลบไฟล์เดิมก่อนจึงจะเพิ่มได้</p>
      ) : (
        <div className={styles.addRow}>
          <select className={styles.input} aria-label="ประเภทเอกสาร" value={kind} onChange={(event) => setKind(event.target.value as VaultKind)}>
            {KINDS.map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}
          </select>
          {kind === "certificate" ? (
            <select className={styles.input} aria-label="ใบรับรองที่เป็น" value={certificationId} onChange={(event) => setCertificationId(event.target.value)}>
              <option value="">ใบรับรองอื่น / ไม่ระบุ</option>
              {CERTIFICATIONS.map((item) => <option key={item.id} value={item.id}>{item.th}</option>)}
            </select>
          ) : null}
          <input ref={fileInput} className={styles.file} type="file" aria-label="เลือกไฟล์" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" />
          <button type="button" className={styles.add} onClick={() => void upload()} disabled={busy}>{busy ? "กำลังอัปโหลด…" : "อัปโหลด"}</button>
        </div>
      )}
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
    </section>
  );
}
