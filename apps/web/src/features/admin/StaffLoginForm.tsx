"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useViewer } from "../../shared/lib/viewer";
import {
  signInAction,
  type StaffSignInState,
} from "./staff-login.actions";
import styles from "./staff-login.module.css";

const INITIAL_STAFF_SIGN_IN_STATE: StaffSignInState = {
  accepted: false,
  error: null,
};

export function StaffLoginForm() {
  const router = useRouter();
  const { signIn: markViewerSignedIn } = useViewer();
  const [state, formAction, pending] = useActionState(
    signInAction,
    INITIAL_STAFF_SIGN_IN_STATE,
  );

  useEffect(() => {
    if (!state.accepted) return;

    // AdminShell still carries prototype display state. It never authorizes a
    // request; this marker only prevents its legacy empty state hiding a page
    // that the server session has already authorized.
    markViewerSignedIn({
      email: "staff",
      name: "เจ้าหน้าที่",
      role: "ผู้ดูแลระบบ",
    });
    router.replace("/admin");
  }, [markViewerSignedIn, router, state.accepted]);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.kicker}>เฉพาะเจ้าหน้าที่</div>
        <h1 className={styles.title}>เข้าสู่ส่วนผู้ดูแลระบบ</h1>
        <p className={styles.description}>
          กรอกรหัสสำหรับเจ้าหน้าที่เพื่อเปิดคิวตรวจสอบและบันทึกกิจกรรม
        </p>

        <form action={formAction} className={styles.form}>
          <div>
            <label className={styles.label} htmlFor="staff-secret">
              รหัสสำหรับเจ้าหน้าที่
            </label>
            <input
              id="staff-secret"
              name="secret"
              type="password"
              className={styles.input}
              autoComplete="current-password"
              required
            />
          </div>

          {state.error && (
            <div className={styles.error} role="alert">
              {state.error}
            </div>
          )}

          <button className={styles.submit} type="submit" disabled={pending}>
            {pending ? "กำลังตรวจสอบ…" : "เข้าสู่ส่วนผู้ดูแลระบบ"}
          </button>
        </form>

        <Link className={styles.publicLink} href="/dashboard">
          ← กลับหน้าสาธารณะ
        </Link>
      </section>
    </main>
  );
}
