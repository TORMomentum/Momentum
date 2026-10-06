"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "./LoginView";
import styles from "../features/auth/auth.module.css";

function ActionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className={styles.split}><div className={styles.formSide}><div className={styles.kicker}>TOR RADAR</div><h1 className={styles.title}>{title}</h1>{children}</div></main>;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`/api/auth/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function VerifyAccountView() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<"ready" | "ok" | "failed">("ready");

  async function verify() {
    const token = params.get("token");
    if (!token) { setState("failed"); return; }
    const response = await post("verify", { token });
    // Remove the email credential from browser history as soon as it is used.
    router.replace("/verify");
    setState(response.ok ? "ok" : "failed");
  }

  return <ActionShell title="ยืนยันอีเมล"><p className={styles.sub}>{state === "ok" ? "ยืนยันอีเมลเรียบร้อยแล้ว คุณสามารถเข้าสู่ระบบได้" : state === "failed" ? "ลิงก์ยืนยันนี้ถูกใช้แล้ว หมดอายุ หรือไม่ถูกต้อง" : "กดปุ่มเพื่อยืนยันอีเมลของคุณ"}</p>{state === "ready" ? <button className={styles.submit} onClick={verify}>ยืนยันอีเมล</button> : <Link className={styles.switchLink} href="/login">ไปที่หน้าเข้าสู่ระบบ</Link>}</ActionShell>;
}

export function ForgotPasswordView() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); await post("password/forgot", { email }); setSent(true); }
  return <ActionShell title="ลืมรหัสผ่าน"><p className={styles.sub}>{sent ? "หากอีเมลนี้มีบัญชีอยู่ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่แล้ว" : "กรอกอีเมลเพื่อรับลิงก์ตั้งรหัสผ่านใหม่"}</p>{!sent && <form className={styles.form} onSubmit={submit}><input className={styles.input} type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /><button className={styles.submit}>ส่งลิงก์</button></form>}</ActionShell>;
}

export function ResetPasswordView() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || password.length < MIN_PASSWORD_LENGTH || password !== confirm) { setError("กรุณาตรวจสอบรหัสผ่านและลิงก์อีกครั้ง"); return; }
    const response = await post("password/reset", { token, password });
    router.replace("/reset-password");
    if (response.ok) setDone(true); else setError("ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุ");
  }
  return <ActionShell title="ตั้งรหัสผ่านใหม่">{done ? <><p className={styles.sub}>ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว และออกจากระบบทุกอุปกรณ์อื่นแล้ว</p><Link className={styles.switchLink} href="/login">ไปที่หน้าเข้าสู่ระบบ</Link></> : <form className={styles.form} onSubmit={submit}><input className={styles.input} type="password" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={`อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`} /><input className={styles.input} type="password" required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="ยืนยันรหัสผ่านใหม่" />{error && <div className={styles.error}>{error}</div>}<button className={styles.submit}>บันทึกรหัสผ่านใหม่</button></form>}</ActionShell>;
}

export function AccountView() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function download() {
    const response = await fetch("/api/auth/me/export", { cache: "no-store" });
    if (!response.ok) { setMessage("ไม่สามารถส่งออกข้อมูลได้"); return; }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "tor-radar-account-export.json"; anchor.click(); URL.revokeObjectURL(url);
  }
  async function remove(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/auth/me", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: password }) });
    setPassword("");
    if (response.ok) { router.replace("/"); router.refresh(); } else setMessage("รหัสผ่านไม่ถูกต้อง หรือไม่สามารถลบบัญชีได้");
  }
  return <ActionShell title="ข้อมูลบัญชีและความเป็นส่วนตัว"><div className={styles.form}><button className={styles.submit} onClick={download}>ดาวน์โหลดข้อมูลของฉัน</button><form className={styles.form} onSubmit={remove}><p className={styles.sub}>การลบบัญชีไม่สามารถย้อนกลับได้ ข้อมูลบัญชีและบุ๊กมาร์กของคุณจะถูกลบ</p><input className={styles.input} type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="รหัสผ่านปัจจุบัน" /><button className={styles.submit}>ลบบัญชีของฉัน</button></form>{message && <div className={styles.error}>{message}</div>}</div></ActionShell>;
}
