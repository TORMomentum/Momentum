"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "../features/auth/auth.module.css";

/**
 * The step between a first Google sign-in and an account (TOR-315, FR-D-3).
 *
 * Google has proved who the person is; it has not asked for the PDPA consent that password registration asks for,
 * so nothing is created until this box is ticked. The ticket that makes the request valid lives in an httpOnly
 * cookie this code cannot read, and it lapses a few minutes after Google returns.
 */
const behaviourEnabled = () => process.env.NEXT_PUBLIC_BEHAVIOUR_ENABLED === "true";

export function GoogleConsentView({ checkMailbox }: { checkMailbox?: boolean } = {}) {
  const [consented, setConsented] = useState(false);
  // Separate and optional, exactly as at password sign-up (TOR-259): never a condition of the account.
  const [behaviourConsented, setBehaviourConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!consented) {
      setError("กรุณายอมรับนโยบายความเป็นส่วนตัวก่อนสร้างบัญชี");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // The email proof stays in the URL fragment until the same-origin consent POST.
      const proof = new URLSearchParams(window.location.hash.slice(1)).get("proof") ?? undefined;
      const response = await fetch("/api/auth/google/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true, proof, ...(behaviourEnabled() && behaviourConsented ? { behaviourConsent: true } : {}) }),
      });
      if (!response.ok) {
        setError("หมดเวลาหรือไม่สามารถสร้างบัญชีได้ กรุณาเริ่มเข้าสู่ระบบด้วย Google ใหม่อีกครั้ง");
        return;
      }
      // A full load, so the header and every server-rendered part are drawn for the signed-in account.
      window.location.assign("/dashboard");
    } catch {
      setError("เชื่อมต่อไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  if (checkMailbox) return (
    <main className={styles.formSide}>
      <h1 className={styles.title}>ยืนยันอีเมลของคุณ</h1>
      <p>เปิดลิงก์ที่เราส่งไปยังอีเมลของคุณในเบราว์เซอร์นี้ เพื่อยืนยันอีเมลและสมัครต่อ</p>
    </main>
  );

  return (
    <main className={styles.split}>
      <div className={styles.formSide}>
        <div className={styles.kicker}>เข้าสู่ระบบด้วย Google</div>
        <h1 className={styles.title}>ยืนยันความยินยอมเพื่อสร้างบัญชี</h1>
        <p className={styles.sub}>
          นี่เป็นการเข้าสู่ระบบด้วย Google ครั้งแรกของคุณ เราจะสร้างบัญชีผู้ประกอบการจากอีเมลที่ Google ยืนยันแล้วเมื่อคุณยินยอมด้านล่างเท่านั้น
        </p>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {error && <div className={styles.error}>{error}</div>}

          <button type="button" className={styles.consent} onClick={() => setConsented((on) => !on)} aria-pressed={consented}>
            <span className={`${styles.consentBox} ${consented ? styles.consentOn : ""}`}>{consented ? "✓" : ""}</span>
            <span>ยินยอมให้เก็บและประมวลผลข้อมูลตามนโยบายความเป็นส่วนตัว (PDPA) · ขอส่งออกหรือลบข้อมูลได้ทุกเมื่อ</span>
          </button>

          {behaviourEnabled() && (
            <button type="button" className={styles.consent} onClick={() => setBehaviourConsented((on) => !on)} aria-pressed={behaviourConsented}>
              <span className={`${styles.consentBox} ${behaviourConsented ? styles.consentOn : ""}`}>{behaviourConsented ? "✓" : ""}</span>
              <span>
                (ไม่บังคับ) ยินยอมให้บันทึกประกาศที่ฉันเปิดดู บันทึก และซ่อน เพื่อปรับคะแนนความเหมาะสม · เปลี่ยนใจและถอนได้ทุกเมื่อในหน้าบัญชี
              </span>
            </button>
          )}

          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? "กำลังดำเนินการ…" : "ยินยอมและสร้างบัญชี"}
          </button>
        </form>

        <Link className={styles.publicEscape} href="/login">
          ← ยกเลิกและกลับไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </main>
  );
}
