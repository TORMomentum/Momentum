"use client";

import { useState } from "react";
import labels from "../../shared/ui/labels.module.css";
import styles from "./tor-detail.module.css";

const ERROR_FALLBACK = "AI ร่างจดหมายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

interface Draft {
  text: string;
  modelVersion: string;
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
 * An AI draft of a cover letter for this TOR (TOR-220). The vendor asks for it, reads and edits it, confirms it
 * and only then downloads it: the confirmation is un-ticked by any edit, so what was confirmed is what is
 * downloaded. Nothing is stored and nothing is sent anywhere on the vendor's behalf.
 */
export function DraftPanel({ torId }: { torId: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (draft && text !== draft.text && !window.confirm("ร่างใหม่จะแทนที่ข้อความที่คุณแก้ไว้ ต้องการดำเนินการต่อหรือไม่")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tors/${encodeURIComponent(torId)}/draft`, { method: "POST" });
      if (!response.ok) {
        setError(await messageOf(response));
        return;
      }
      const result = (await response.json()) as Draft;
      setDraft(result);
      setText(result.text);
      setConfirmed(false);
    } catch {
      setError(ERROR_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    // A byte-order mark so Windows editors read the Thai as UTF-8.
    const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cover-letter.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={styles.biddingBlock} aria-labelledby="draft-heading">
      <h2 id="draft-heading" className={labels.blockLabel}>
        ร่างจดหมายนำเสนอ — สร้างโดย AI
      </h2>
      <div className={styles.biddingRaw}>
        เมื่อกดขอร่าง ระบบส่งโปรไฟล์ของคุณ ข้อมูลของ TOR นี้ และชื่อไฟล์ใน vault (ไม่ส่งตัวไฟล์) ไปยัง Vertex AI และไม่เก็บร่างไว้
        ร่างนี้ไม่ถูกยื่นให้ที่ใด คุณต้องตรวจและยืนยันก่อนดาวน์โหลด
      </div>

      {!draft && (
        <button type="button" className={styles.draftButton} onClick={generate} disabled={busy}>
          {busy ? "กำลังร่าง…" : "ให้ AI ร่างจดหมาย"}
        </button>
      )}
      {error && <p className={styles.draftError} role="alert">{error}</p>}

      {draft && (
        <>
          <div className={styles.biddingRaw}>ร่างโดย AI (โมเดล {draft.modelVersion}) — ข้อความในวงเล็บเหลี่ยมคือส่วนที่ต้องกรอกเอง</div>
          <textarea
            className={styles.draftText}
            aria-label="ร่างจดหมายนำเสนอ"
            value={text}
            rows={16}
            onChange={(event) => {
              setText(event.target.value);
              setConfirmed(false);
            }}
          />
          <label className={styles.draftConfirm}>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> ฉันตรวจสอบและแก้ไขข้อความนี้แล้ว
          </label>
          <div className={styles.draftActions}>
            <button type="button" className={styles.draftButton} onClick={download} disabled={!confirmed || text.trim() === ""}>
              ดาวน์โหลด (.txt)
            </button>
            <button type="button" className={styles.draftSecondary} onClick={generate} disabled={busy}>
              {busy ? "กำลังร่าง…" : "ร่างใหม่"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
