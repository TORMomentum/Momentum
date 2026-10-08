"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "./LoginView";
import styles from "../features/auth/auth.module.css";
import account from "../features/account/account.module.css";
function Shell({ title, children }: { title: string; children: React.ReactNode }) { return <main className={styles.split}><div className={styles.formSide}><div className={styles.kicker}>TOR RADAR</div><h1 className={styles.title}>{title}</h1>{children}</div></main>; }
function post(path: string, body: unknown) { return fetch(`/api/auth/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
/** What the account agreed to, and when — shown so it can be withdrawn. */
export interface ConsentRecord {
  noticeVersion: string;
  agreedAt: string;
  withdrawnAt?: string;
}

export function VerifyAccountView() { const token = useSearchParams().get("token"); const [done, setDone] = useState(false); return <Shell title="ยืนยันอีเมล"><p className={styles.sub}>{done ? "ยืนยันอีเมลเรียบร้อยแล้ว" : "กดปุ่มเพื่อยืนยันอีเมลของคุณ"}</p>{!done && <button className={styles.submit} onClick={async () => { if (token && (await post("verify", { token })).ok) setDone(true); }}>ยืนยันอีเมล</button>}<Link className={styles.switchLink} href="/login">เข้าสู่ระบบ</Link></Shell>; }
export function ForgotPasswordView() { const [email, setEmail] = useState(""); const [done, setDone] = useState(false); return <Shell title="ลืมรหัสผ่าน">{done ? <p className={styles.sub}>หากบัญชีนี้มีอยู่ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว</p> : <form className={styles.form} onSubmit={async (event) => { event.preventDefault(); await post("password/forgot", { email }); setDone(true); }}><input className={styles.input} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /><button className={styles.submit}>ส่งลิงก์</button></form>}</Shell>; }
export function ResetPasswordView() { const token = useSearchParams().get("token"); const [password, setPassword] = useState(""); const [done, setDone] = useState(false); return <Shell title="ตั้งรหัสผ่านใหม่">{done ? <Link className={styles.switchLink} href="/login">เข้าสู่ระบบ</Link> : <form className={styles.form} onSubmit={async (event) => { event.preventDefault(); if (token && password.length >= MIN_PASSWORD_LENGTH && (await post("password/reset", { token, password })).ok) setDone(true); }}><input className={styles.input} type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button className={styles.submit}>บันทึกรหัสผ่านใหม่</button></form>}</Shell>; }
/**
 * Everything an account holds, and the two ways to be rid of it.
 *
 * This screen was built from the sign-in form's styles, so downloading your
 * data, withdrawing consent and deleting your account were three identical
 * primary buttons. Deletion is now plainly a different kind of act — its own
 * block, its own colour, and the password asked for in the same breath.
 */
export function AccountView({ consent: initialConsent }: { consent: ConsentRecord | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [consent, setConsent] = useState<ConsentRecord | null>(initialConsent);

  async function download() {
    const response = await fetch("/api/auth/me/export", { cache: "no-store" });
    if (!response.ok) {
      setMessage({ text: "ไม่สามารถส่งออกข้อมูลได้", bad: true });
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tor-radar-account-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function withdraw() {
    const response = await post("me/consent/withdraw", {});
    if (!response.ok) {
      setMessage({ text: "ไม่สามารถถอนความยินยอมได้", bad: true });
      return;
    }
    setConsent((current) => (current ? { ...current, withdrawnAt: new Date().toISOString() } : current));
    setMessage({ text: "ถอนความยินยอมแล้ว", bad: false });
  }

  async function remove(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/auth/me", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: password }),
    });
    if (response.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setMessage({ text: "รหัสผ่านไม่ถูกต้อง หรือไม่สามารถลบบัญชีได้", bad: true });
  }

  return (
    <main className={account.page}>
      <header className={account.head}>
        <h1 className={account.title}>ข้อมูลบัญชีและความเป็นส่วนตัว</h1>
        <p className={account.sub}>
          ส่งออกหรือลบข้อมูลของคุณได้ทุกเมื่อ ตามสิทธิ์ของเจ้าของข้อมูลส่วนบุคคล
        </p>
      </header>

      <section className={account.card}>
        <h2 className={account.cardTitle}>ส่งออกข้อมูลของคุณ</h2>
        <p className={account.cardBody}>
          ดาวน์โหลดทุกอย่างที่บัญชีนี้เก็บไว้เป็นไฟล์ JSON — ข้อมูลบัญชี ความยินยอม
          โปรไฟล์ และ TOR ที่บันทึกไว้ ไม่รวมรหัสผ่าน
        </p>
        <button type="button" className={account.action} onClick={download}>
          ดาวน์โหลดข้อมูลของฉัน
        </button>
      </section>

      {consent && (
        <section className={account.card}>
          <h2 className={account.cardTitle}>ความยินยอมในการประมวลผลข้อมูล</h2>
          <div className={account.factRow}>
            <span className={account.fact}>
              <span className={account.factLabel}>ให้ความยินยอมเมื่อ</span>
              <span className={account.factValue}>
                {new Date(consent.agreedAt).toLocaleDateString("th-TH", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </span>
            <span className={account.fact}>
              <span className={account.factLabel}>ประกาศความเป็นส่วนตัวฉบับ</span>
              <span className={account.factValue}>{consent.noticeVersion}</span>
            </span>
          </div>
          {consent.withdrawnAt ? (
            <span className={account.withdrawn}>ถอนความยินยอมแล้ว</span>
          ) : (
            <>
              <p className={account.cardBody}>
                การถอนความยินยอมจะหยุดการประมวลผลเพื่อการจับคู่และการแจ้งเตือนเท่านั้น
                บัญชีและข้อมูลอื่นยังอยู่ หากต้องการลบทั้งหมด ให้ลบบัญชีด้านล่าง
              </p>
              <button type="button" className={account.action} onClick={withdraw}>
                ถอนความยินยอม
              </button>
            </>
          )}
        </section>
      )}

      <section className={`${account.card} ${account.cardDanger}`}>
        <h2 className={account.cardTitle}>ลบบัญชีถาวร</h2>
        <p className={account.cardBody}>
          อีเมล โปรไฟล์ และ TOR ที่บันทึกไว้จะถูกลบ และคุณจะถูกออกจากระบบทุกอุปกรณ์
          การลบไม่สามารถย้อนกลับได้ — กรอกรหัสผ่านปัจจุบันเพื่อยืนยันว่าเป็นคุณ
        </p>
        <form className={account.deleteForm} onSubmit={remove}>
          <input
            className={account.input}
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="รหัสผ่านปัจจุบัน"
            aria-label="รหัสผ่านปัจจุบัน"
            autoComplete="current-password"
          />
          <button type="submit" className={`${account.action} ${account.actionDanger}`}>
            ลบบัญชีของฉัน
          </button>
        </form>
      </section>

      {message && (
        <p className={`${account.message} ${message.bad ? account.messageBad : ""}`} role="status">
          {message.text}
        </p>
      )}
    </main>
  );
}

